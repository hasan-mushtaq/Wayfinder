import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { Spanner } from "@google-cloud/spanner";
import { VertexAI } from "@google-cloud/vertexai";
import { ReasoningEngineExecutionServiceClient, ReasoningEngineServiceClient } from "@google-cloud/aiplatform";
import { GoogleAuth } from "google-auth-library";
import { Client as VertexClient } from "@google-cloud/vertexai";
import cors from "cors";
import wellknown from "wellknown";
import { GoogleGenerativeAI } from "@google/generative-ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Helper: Rephrase Route with Gemini ---
async function rephraseRoute(rawSteps: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    console.log("Gemini API Key not configured or placeholder used, skipping rephrasing.");
    return rawSteps;
  }

  try {
    console.log("Rephrasing route with Gemini...");
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.0-flash",
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 1024,
      }
    });

    const prompt = `You are an elite concierge at a luxury venue. Your goal is to guide a guest through the building using the following navigation steps.

Make the directions sound professional, natural, and inviting. 

CONSTRAINTS:
- DO NOT use the phrase "pass through" more than once. Use words like "head into", "continue towards", "cross", "proceed to", or "move through".
- Group adjacent locations together (e.g., "Walk through the successive pedestrian zones").
- Be concise but helpful.
- Mention floor changes (up/down) clearly.

Raw Navigation Data:
${rawSteps}

Your Human-Friendly Navigation Guide:`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    
    if (text) {
      console.log("Successfully rephrased route.");
      return text;
    }
    return rawSteps;
  } catch (err) {
    console.error("Error rephrasing route with Gemini:", err);
    return rawSteps;
  }
}

// --- Helper: Get Floor Levels ---
function getLevelsSync() {
  try {
    const geojsonDir = path.join(__dirname, "src", "data", "geojson");
    const levelFilePath = path.join(geojsonDir, "level.geojson");
    if (fs.existsSync(levelFilePath)) {
      const content = fs.readFileSync(levelFilePath, "utf8");
      const geojson = JSON.parse(content);
      if (geojson.features) {
        return geojson.features.map((f: any) => ({
          id: f.id,
          name: f.properties.name?.en || f.properties.name || "Unnamed Level",
          short_name: f.properties.short_name?.en || f.properties.short_name || "",
          ordinal: f.properties.ordinal ?? 0
        })).sort((a: any, b: any) => a.ordinal - b.ordinal);
      }
    }
  } catch (e) {
    console.warn("Error reading levels in backend:", e);
  }
  return [];
}

// --- Spanner Configuration ---
// Default to the project where the database is located, but allow override via environment variable.
const targetProjectId = process.env.SPANNER_PROJECT_ID || "no-genai-live";
const instanceId = "indoor-routing";
const databaseId = "routing";

// Initialize Spanner with metrics disabled and explicit quota project
const spanner = new Spanner({ 
  projectId: targetProjectId,
  // Force the quota/billing to be attributed to the target project
  // This helps avoid "API not enabled" errors in the local preview project.
  quotaProjectId: targetProjectId,
  // Disable client-side metrics to prevent "Send TimeSeries failed" errors
  // if the service account lacks monitoring.metricWriter permissions.
  clientSideMetricsConfig: { enabled: false },
  // Some versions of the SDK might use monitoringConfig
  monitoringConfig: { enabled: false },
  // Another way to disable monitoring in some versions
  monitoring: false
} as any);
const instance = spanner.instance(instanceId);
const database = instance.database(databaseId);

// --- TypeScript Interfaces ---
interface SpannerRow {
  node_id: string;
  name: string;
  category: string;
  geom_geojson: string; // From ST_ASGEOJSON(geom)
}

interface GeoJSONFeature {
  type: "Feature";
  geometry: any;
  properties: any;
}

interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

// --- Global Error Handlers to suppress background Spanner metrics errors ---
process.on("unhandledRejection", (reason: any) => {
  // Suppress "Send TimeSeries failed" background errors from Spanner
  if (reason?.message?.includes("Send TimeSeries failed") || reason?.message?.includes("monitoring metric writer permission")) {
    // Silently ignore background metrics errors as they don't affect functionality
    return;
  }
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error: any) => {
  // Suppress "Send TimeSeries failed" background errors from Spanner
  if (error?.message?.includes("Send TimeSeries failed") || error?.message?.includes("monitoring metric writer permission")) {
    // Silently ignore background metrics errors as they don't affect functionality
    return;
  }
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

// --- Reasoning Engine Session Management ---
const agentSessions: Record<string, string> = {};

async function getOrCreateAgentSession(name: string, userId: string, project: string, location: string): Promise<string> {
  const sessionKey = `${name}:${userId}`;
  if (agentSessions[sessionKey]) {
    return agentSessions[sessionKey];
  }

  console.log(`Creating new session for user ${userId} on agent ${name}...`);
  
  // Use VertexClient for session creation as it handles the payload structure more explicitly
// Use the standard Execution Client instead of VertexClient
  const client = new ReasoningEngineExecutionServiceClient({
    apiEndpoint: `${location}-aiplatform.googleapis.com`,
    projectId: project,
  });

  // Bypass TS Promise bug with (await ...) as any, and use Protobuf 'fields' format
  const [response] = (await client.queryReasoningEngine({
    name: name,
    classMethod: "create_session",
    input: { 
      fields: {
        user_id: { stringValue: userId }
      }
    }
  })) as any;

  // --- PROTOBUF UNWRAPPING LOGIC ---
  let sessionId = null;
  const output = response.output;

  if (output) {
    // 1. Handle Protobuf Struct (gRPC SDK behavior)
    if (output.structValue?.fields?.id?.stringValue) {
      sessionId = output.structValue.fields.id.stringValue;
    }
    // 2. Handle plain object (REST fallback)
    else if (output.id) {
      sessionId = output.id;
    }
    // 3. Handle stringified JSON
    else if (typeof output === 'string') {
      try {
        const parsed = JSON.parse(output.match(/\{[\s\S]*\}/)?.[0] || output);
        sessionId = parsed?.id;
      } catch (e) {}
    }
  }

  // 4. Ultimate fallback to raw response
  if (!sessionId && (response as any).id) {
    sessionId = (response as any).id;
  }

  if (!sessionId) {
    // Log the raw structure so we can inspect it if it fails again
    console.error("RAW GRPC RESPONSE:", JSON.stringify(response, null, 2));
    throw new Error("Failed to create agent session: No session ID found in Protobuf struct.");
  }
  // ---------------------------------

  agentSessions[sessionKey] = sessionId;
  console.log(`Session created: ${sessionId}`);
  return sessionId;
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json());

  // --- API Endpoint: Get Map Nodes ---
  app.get("/api/map-nodes", async (req, res) => {
    try {
      // 1. Try to load local GeoJSON files first (as requested by user)
      const geojsonDir = path.join(__dirname, "src", "data", "geojson");
      const filesToLoad = [
        "venue.geojson",
        "footprint.geojson",
        "level.geojson",
        "unit.geojson",
        "opening.geojson",
        "amenity.geojson",
        "anchor.geojson"
      ];

      let combinedFeatures: GeoJSONFeature[] = [];
      let loadedFiles: string[] = [];

      for (const fileName of filesToLoad) {
        const filePath = path.join(geojsonDir, fileName);
        if (fs.existsSync(filePath)) {
          try {
            const content = fs.readFileSync(filePath, "utf8");
            const geojson = JSON.parse(content);
            if (geojson.features) {
              // Add source file info to properties and filter out anchors
              const featuresWithSource = geojson.features
                .filter((f: any) => {
                  const nodeType = f.feature_type || (f.properties && f.properties.feature_type) || fileName.split('.')[0];
                  return nodeType !== 'anchor';
                })
                .map((f: any) => ({
                  ...f,
                  properties: {
                    ...(f.properties || {}),
                    source_file: fileName,
                    node_type: f.feature_type || (f.properties && f.properties.feature_type) || fileName.split('.')[0]
                  }
                }));
              combinedFeatures = [...combinedFeatures, ...featuresWithSource];
              loadedFiles.push(fileName);
            }
          } catch (err) {
            console.error(`Error parsing ${fileName}:`, err);
          }
        }
      }

      if (combinedFeatures.length > 0) {
        console.log(`Loaded ${combinedFeatures.length} features from ${loadedFiles.length} local GeoJSON files.`);
        return res.json({
          type: "FeatureCollection",
          features: combinedFeatures,
          source: "local_geojson",
          loaded_files: loadedFiles
        });
      }

      // 2. Fallback to Spanner if no local files or they are empty
      let tableList: string[] = [];
      try {
        const [tables] = await database.run("SELECT table_name FROM information_schema.tables WHERE table_schema = ''");
        tableList = tables.map((t: any) => t.toJSON().table_name);
        console.log("Available tables in Spanner:", tableList);
      } catch (e) {
        console.warn("Could not list tables:", e);
      }

      // Fetch from Map_Nodes. 
      const query = {
        sql: `
          SELECT 
            node_id, 
            node_type,
            category, 
            name, 
            level_name, 
            floor_number, 
            building_name, 
            venue_name, 
            occupant_names, 
            occupant_categories, 
            hours, 
            search_context, 
            geom as geom_wkt
          FROM Map_Nodes
          WHERE floor_number = '1' AND node_type != 'anchor'
        `,
      };

      const [rows] = await database.run(query);
      
      const features: GeoJSONFeature[] = rows.map((row: any) => {
        const spannerRow = row.toJSON();
        const geometry = spannerRow.geom_wkt ? wellknown.parse(spannerRow.geom_wkt) : null;
        
        let displayName = (spannerRow.name || "").trim();
        if (!displayName && spannerRow.occupant_names) displayName = (spannerRow.occupant_names || "").trim();
        if (!displayName) displayName = (spannerRow.category || "").trim();
        
        if (displayName) {
          displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
        } else {
          displayName = "Unnamed Node";
        }

        return {
          type: "Feature",
          geometry: geometry,
          properties: {
            node_id: spannerRow.node_id,
            node_type: spannerRow.node_type || "",
            category: spannerRow.category || "",
            name: displayName,
            original_name: spannerRow.name || "",
            level_name: spannerRow.level_name || "",
            floor_number: spannerRow.floor_number || "",
            building_name: spannerRow.building_name || "",
            venue_name: spannerRow.venue_name || "",
            occupant_names: spannerRow.occupant_names || "",
            occupant_categories: spannerRow.occupant_categories || "",
            hours: spannerRow.hours || "",
            search_context: spannerRow.search_context || "",
          },
        };
      });

      res.json({
        type: "FeatureCollection",
        features: features,
        source: "spanner",
        available_tables: tableList
      });
    } catch (error: any) {
      console.error("Error in /api/map-nodes:", error.message);
      
      const isApiDisabled = error.message.includes("Cloud Spanner API has not been used") || error.message.includes("PERMISSION_DENIED");
      const enableApiUrl = isApiDisabled ? `https://console.developers.google.com/apis/api/spanner.googleapis.com/overview?project=274179932022` : null;

      // --- Mock Data Fallback ---
      const mockFeatures: GeoJSONFeature[] = [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-121.888, 37.329] },
          properties: { node_id: "m1", name: "Main Entrance", category: "facility" }
        }
      ];

      res.json({
        type: "FeatureCollection",
        features: mockFeatures,
        source: "mock",
        error: error.message,
        isApiDisabled,
        enableApiUrl
      });
    }
  });

  // --- API Endpoint: Get Levels ---
  app.get("/api/levels", async (req, res) => {
    try {
      const levels = getLevelsSync();
      res.json(levels);
    } catch (error: any) {
      console.error("Error in /api/levels:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // --- API Endpoint: Get Route ---
  app.post("/api/route", async (req, res) => {
    const { startNodeId, endNodeId } = req.body;

    if (!startNodeId || !endNodeId) {
      return res.status(400).json({ error: "startNodeId and endNodeId are required" });
    }

    try {
      const query = {
        sql: `
          GRAPH indoorRoutingGraph
          MATCH p = ANY SHORTEST (start_node:Node {
            node_id: @startNodeId
          })-[e:connectsTo]->{1, 20} (end_node:Node {
            node_id: @endNodeId
          })
          RETURN
            SAFE_TO_JSON(NODES(p)) AS route_nodes,
            SAFE_TO_JSON(EDGES(p)) AS route_edges;
        `,
        params: {
          startNodeId,
          endNodeId,
        },
      };

      const [rows] = await database.run(query);
      
      if (rows.length === 0) {
        return res.status(404).json({ error: "No route found" });
      }

      const row = rows[0].toJSON();
      const routeNodes = typeof row.route_nodes === 'string' ? JSON.parse(row.route_nodes) : row.route_nodes;
      
      // Convert route nodes to a list of coordinates
      const coordinates = routeNodes.map((node: any) => {
        // Based on the Spanner Graph example, properties are in node.properties
        const props = node.properties || {};
        const geom = props.geom;
        
        if (geom) {
          try {
            const geometry = wellknown.parse(geom);
            if (geometry && geometry.type === 'Point') {
              return geometry.coordinates;
            }
          } catch (e) {
            console.warn("Failed to parse geometry:", geom);
          }
        }
        return null;
      }).filter((c: any) => c !== null);

      // Generate descriptive instructions for rephrasing
      const levels = getLevelsSync();
      const steps: string[] = [];
      routeNodes.forEach((node: any, index: number) => {
        const props = node.properties || {};
        const name = props.name || (props.category ? props.category.replace(/\./g, ' ') : props.node_type);
        const capitalized = typeof name === 'string' ? (name.charAt(0).toUpperCase() + name.slice(1)) : 'Point';
        const category = (props.category || '').toLowerCase();
        const levelId = props.level_id || props.levelId || props.floor_number;

        if (index > 0) {
          const prevNode = routeNodes[index - 1];
          const prevProps = prevNode.properties || {};
          const prevLevelId = prevProps.level_id || prevProps.levelId || prevProps.floor_number;

          if (prevLevelId && levelId && String(prevLevelId) !== String(levelId)) {
            const currentLevel = levels.find(l => String(l.id) === String(levelId) || String(l.ordinal) === String(levelId));
            const prevLevel = levels.find(l => String(l.id) === String(prevLevelId) || String(l.ordinal) === String(prevLevelId));
            
            if (currentLevel && prevLevel) {
              const direction = currentLevel.ordinal > prevLevel.ordinal ? 'up' : 'down';
              let facility = 'stairs/elevator';
              const combinedCategory = (category + ' ' + (prevProps.category || '').toLowerCase());
              if (combinedCategory.includes('elevator')) facility = 'elevator';
              else if (combinedCategory.includes('escalator')) facility = 'escalator';
              else if (combinedCategory.includes('stairs') || combinedCategory.includes('steps')) facility = 'stairs';
              steps.push(`take the ${facility} ${direction} to ${currentLevel.name}`);
            }
          }
        }

        let stepText = '';
        if (index === 0) stepText = `Start at ${capitalized}`;
        else if (index === routeNodes.length - 1) stepText = `arrive at ${capitalized}`;
        else {
          const isFacility = category.includes('elevator') || category.includes('escalator') || category.includes('stairs') || category.includes('steps');
          stepText = isFacility ? `pass through the ${name.toLowerCase()} area` : `pass through ${capitalized}`;
        }

        if (steps.length === 0 || steps[steps.length - 1] !== stepText) {
          steps.push(stepText);
        }
      });

      const rawDescription = steps.length > 1 
        ? `${steps.slice(0, -1).join(', ')}, and finally ${steps[steps.length - 1]}.`
        : `You are already at your destination.`;

      const finalDescription = await rephraseRoute(rawDescription);

      res.json({
        nodes: routeNodes,
        coordinates: coordinates,
        source: "spanner_graph",
        description: finalDescription
      });
    } catch (error: any) {
      console.error("Error in /api/route:", error.message);
      
      // Mock fallback for routing if Spanner fails
      // In a real app, you'd want a more robust fallback or a clear error.
      res.status(500).json({ 
        error: error.message,
        details: "Routing requires a live Spanner Graph connection with the 'indoorRoutingGraph' defined."
      });
    }
  });

  // --- API Endpoint: Get Route via Agent (Reasoning Engine) ---
  app.post("/api/agent-route", async (req, res) => {
    const { startNodeId, endNodeId, agentId: customAgentId, method: customMethod } = req.body;
    const reasoningEngineId = customAgentId || "1865942150835863552";
    const classMethod = customMethod || "query";
    const project = "464794370950";
    const location = "us-central1";
    const clientConfig: any = {
      apiEndpoint: `${location}-aiplatform.googleapis.com`,
      projectId: project,
    };

    if (!startNodeId || !endNodeId) {
      return res.status(400).json({ error: "startNodeId and endNodeId are required" });
    }

    try {
      console.log(`Querying Reasoning Engine ${reasoningEngineId} for route...`);
      
      const auth = new GoogleAuth();
      
      let currentIdentity = "Unknown";
      try {
        const credentials = await auth.getCredentials();
        currentIdentity = credentials.client_email || "Default Service Account";
        console.log(`Current Identity: ${currentIdentity}`);
      } catch (e) {
        console.log("Could not determine current identity");
      }
      (req as any).currentIdentity = currentIdentity;

      const inputPayload = { 
        message: `Find the shortest route from node ${startNodeId} to node ${endNodeId}. Return the route as a JSON object with 'nodes' and 'coordinates' fields compatible with the existing routing API.` 
      };

      const name = `projects/${project}/locations/${location}/reasoningEngines/${reasoningEngineId}`;
      const userId = (req as any).currentIdentity || `user_${Date.now()}`;

      // Helper for streaming execution
      const executeStreaming = async (client: any) => {
        // 1. Ensure we have a session
        const sessionId = await getOrCreateAgentSession(name, userId, project, location);

        // 2. Execute streaming query
        // 2. Execute streaming query
        console.log(`Attempting streaming query via standard client for session ${sessionId}...`);
        const stream = client.streamQueryReasoningEngine({
          name: name,
          input: {
            fields: {
              user_id: { stringValue: userId },
              session_id: { stringValue: sessionId },
              message: { stringValue: inputPayload.message }
            }
          }
        });

        let fullOutput = "";
        let chunkCount = 0;

        for await (const chunk of stream) {
          chunkCount++;
          let rawText = "";

          // THE FIX: gRPC HttpBody payloads hide the stream inside 'data' as a Buffer
          if (chunk.data) {
            rawText = Buffer.isBuffer(chunk.data) || chunk.data instanceof Uint8Array
              ? Buffer.from(chunk.data).toString('utf8')
              : String(chunk.data);
          } 
          // Fallbacks just in case the SDK formats it differently
          else if (typeof chunk === 'string') {
            rawText = chunk;
          } else if (chunk.stringValue) {
            rawText = chunk.stringValue;
          } else if (chunk.output?.stringValue) {
            rawText = chunk.output.stringValue;
          }

          if (rawText) {
            fullOutput += rawText;
          }
        }

        console.log(`Stream complete. Received ${chunkCount} chunks. Total text length: ${fullOutput.length}`);
        
        // Let's print the first 250 characters of the decoded text so we can see exactly 
        // how the ADK agent formats its response (e.g., raw text vs Server-Sent Events)
       console.log(`Stream complete. Received ${chunkCount} chunks. Total text length: ${fullOutput.length}`);

        // --- AGENT TRACE PARSER ---
        let humanText = "";
        let extractedRouteData = null;

        // The stream returns JSON Lines (NDJSON). We split by newline to parse each step.
        const lines = fullOutput.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            const parts = parsed.content?.parts || [];

            for (const part of parts) {
              // 1. Extract the human-readable conversational text
              if (part.text) {
                humanText += part.text;
              }

              // 2. (Optional) Extract the hidden Spanner Graph data if the map needs it to draw the line
              if (part.function_response?.name === "find_shortest_route") {
                const resultString = part.function_response.response?.result;
                if (resultString) {
                  extractedRouteData = JSON.parse(resultString);
                }
              }
            }
          } catch (e) {
            // Ignore partial or unparseable lines
          }
        }

        // Clean up any weird formatting characters the agent might include
        humanText = humanText.trim().replace(/\\n/g, '\n');

        return {
          output: humanText || fullOutput, // Fallback to raw if parser finds nothing
          routeData: extractedRouteData,   // Passes the raw graph JSON to your frontend map
          source: "agent_engine_stream"
        };
      };

      // Handle ADK-style streaming agents explicitly if requested
      if (classMethod === "stream_query" || classMethod === "async_stream_query") {
        const client = new ReasoningEngineExecutionServiceClient(clientConfig);
        const result = await executeStreaming(client);
        return res.json(result);
      }

      // Fallback to unary query for non-streaming agents
      try {
        const client = new ReasoningEngineExecutionServiceClient(clientConfig);
        const [response] = await (client as any).queryReasoningEngine({
          name,
          input: inputPayload,
          classMethod: classMethod // Standard client uses camelCase
        });

        console.log("Reasoning Engine route response received successfully.");
        let result = response.output;
        
        // If the result is a string, try to parse it as JSON
        if (typeof result === 'string') {
          try {
            const jsonMatch = result.match(/```json\n([\s\S]*?)\n```/) || result.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              result = JSON.parse(jsonMatch[1] || jsonMatch[0]);
            }
          } catch (e) {
            console.warn("Failed to parse agent output as JSON:", result);
          }
        }

        res.json({
          ...result,
          source: "agent_engine"
        });
      } catch (unaryError: any) {
        const errorString = (unaryError.message || "") + (unaryError.details || "");
        console.warn("Unary route query failed:", unaryError.message, "Details:", unaryError.details);
        
        // If it's the default 'query' method and it's not found, try streaming as a fallback
        // We check both message and details as different SDK versions/errors put the info in different places
        const isMethodNotFound = errorString.toLowerCase().includes("method query not found") || 
                               errorString.toLowerCase().includes("method `query` not found") ||
                               errorString.toLowerCase().includes("method 'query' not found");
                               
        if (classMethod === "query" && isMethodNotFound) {
          console.log("Method 'query' not found, attempting ADK-style streaming fallback...");
          try {
            const client = new ReasoningEngineExecutionServiceClient(clientConfig);
            const result = await executeStreaming(client);
            return res.json(result);
          } catch (streamError: any) {
            console.error("Streaming fallback also failed:", streamError.message, streamError.details);
            throw unaryError; // Throw the original error if fallback also fails
          }
        }
        throw unaryError;
      }
    } catch (error: any) {
      let errorMessage = error.message;
      let hint = "";
      let availableMethods: any[] = [];
      
      // Try to fetch reasoning engine details for better debugging
      try {
        const adminClient = new ReasoningEngineServiceClient(clientConfig);
        const [engine] = await adminClient.getReasoningEngine({ name: `projects/${project}/locations/${location}/reasoningEngines/${reasoningEngineId}` });
        console.log("Fetched Reasoning Engine Details:", JSON.stringify(engine, null, 2));
        if (engine.spec && (engine.spec as any).classMethods) {
          availableMethods = (engine.spec as any).classMethods;
        }
      } catch (adminError) {
        console.warn("Could not fetch reasoning engine details:", adminError);
      }
      
      if (errorMessage.includes("method `query` not found")) {
        hint = "The Reasoning Engine exists but does not expose a 'query' method. Available methods from spec: " + 
               (availableMethods.length > 0 ? availableMethods.map(m => m.name || JSON.stringify(m)).join(", ") : "None found in spec");
      }

      console.error("Detailed Error in /api/agent-route:", {
        message: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details,
        hint
      });
      res.status(500).json({ 
        error: errorMessage,
        details: error.stack,
        code: error.code,
        serviceAccount: (req as any).currentIdentity || "Unknown",
        hint
      });
    }
  });

  // --- API Endpoint: General Agent Chat (Reasoning Engine) ---
  app.post("/api/agent-chat", async (req, res) => {
    const { message, agentId: customAgentId, method: customMethod } = req.body;
    const reasoningEngineId = customAgentId || "1865942150835863552";
    const classMethod = customMethod || "query";
    const project = "464794370950";
    const location = "us-central1";
    const clientConfig: any = {
      apiEndpoint: `${location}-aiplatform.googleapis.com`,
      projectId: project,
    };

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    try {
      console.log(`Querying Reasoning Engine ${reasoningEngineId} for chat...`);
      
      const auth = new GoogleAuth();

      let currentIdentity = "Unknown";
      try {
        const credentials = await auth.getCredentials();
        currentIdentity = credentials.client_email || "Default Service Account";
        console.log(`Current Identity: ${currentIdentity}`);
      } catch (e) {
        console.log("Could not determine current identity");
      }
      (req as any).currentIdentity = currentIdentity;

      const name = `projects/${project}/locations/${location}/reasoningEngines/${reasoningEngineId}`;
      const userId = (req as any).currentIdentity || `user_${Date.now()}`;

      // Helper for streaming execution
      const executeStreaming = async (client: any) => {
        // 1. Ensure we have a session
        const sessionId = await getOrCreateAgentSession(name, userId, project, location);

        // 2. Execute streaming query
        // 2. Execute streaming chat
        console.log(`Attempting streaming chat via standard client for session ${sessionId}...`);
        const stream = client.streamQueryReasoningEngine({
          name: name,
          input: {
            fields: {
              user_id: { stringValue: userId },
              session_id: { stringValue: sessionId },
              message: { stringValue: message }
            }
          }
        });

        let fullOutput = "";
        let chunkCount = 0;

        for await (const chunk of stream) {
          chunkCount++;
          let rawText = "";

          // THE FIX: gRPC HttpBody payloads hide the stream inside 'data' as a Buffer
          if (chunk.data) {
            rawText = Buffer.isBuffer(chunk.data) || chunk.data instanceof Uint8Array
              ? Buffer.from(chunk.data).toString('utf8')
              : String(chunk.data);
          } 
          // Fallbacks just in case the SDK formats it differently
          else if (typeof chunk === 'string') {
            rawText = chunk;
          } else if (chunk.stringValue) {
            rawText = chunk.stringValue;
          } else if (chunk.output?.stringValue) {
            rawText = chunk.output.stringValue;
          }

          if (rawText) {
            fullOutput += rawText;
          }
        }

        console.log(`Stream complete. Received ${chunkCount} chunks. Total text length: ${fullOutput.length}`);

        // --- AGENT TRACE PARSER ---
        let humanText = "";
        let extractedRouteData = null;

        // The stream returns JSON Lines (NDJSON). We split by newline to parse each step.
        const lines = fullOutput.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            const parts = parsed.content?.parts || [];

            for (const part of parts) {
              // 1. Extract the human-readable conversational text
              if (part.text) {
                humanText += part.text;
              }

              // 2. (Optional) Extract the hidden Spanner Graph data if the map needs it to draw the line
              if (part.function_response?.name === "find_shortest_route") {
                const resultString = part.function_response.response?.result;
                if (resultString) {
                  extractedRouteData = JSON.parse(resultString);
                }
              }
            }
          } catch (e) {
            // Ignore partial or unparseable lines
          }
        }

        // Clean up any weird formatting characters the agent might include
        humanText = humanText.trim().replace(/\\n/g, '\n');

        return {
          output: humanText || fullOutput, // Fallback to raw if parser finds nothing
          routeData: extractedRouteData,   // Passes the raw graph JSON to your frontend map
          source: "agent_engine_stream"
        };
      };

      // Handle ADK-style streaming agents explicitly if requested
      if (classMethod === "stream_query" || classMethod === "async_stream_query") {
        const client = new ReasoningEngineExecutionServiceClient(clientConfig);
        const result = await executeStreaming(client);
        return res.json(result);
      }

      // Fallback to unary query for non-streaming agents
      try {
        const client = new ReasoningEngineExecutionServiceClient(clientConfig);
        const [response] = await (client as any).queryReasoningEngine({
          name,
          input: {
            message: message
          },
          classMethod: classMethod // Standard client uses camelCase
        });

        console.log("Reasoning Engine chat response received successfully.");
        res.json({
          output: response.output,
          source: "agent_engine"
        });
      } catch (unaryError: any) {
        const errorString = (unaryError.message || "") + (unaryError.details || "");
        console.warn("Unary chat query failed:", unaryError.message, "Details:", unaryError.details);

        // If it's the default 'query' method and it's not found, try streaming as a fallback
        const isMethodNotFound = errorString.toLowerCase().includes("method query not found") || 
                               errorString.toLowerCase().includes("method `query` not found") ||
                               errorString.toLowerCase().includes("method 'query' not found");

        if (classMethod === "query" && isMethodNotFound) {
          console.log("Method 'query' not found, attempting ADK-style streaming fallback...");
          try {
            const client = new ReasoningEngineExecutionServiceClient(clientConfig);
            const result = await executeStreaming(client);
            return res.json(result);
          } catch (streamError: any) {
            console.error("Streaming fallback also failed:", streamError.message, streamError.details);
            throw unaryError; // Throw the original error if fallback also fails
          }
        }
        throw unaryError;
      }
    } catch (error: any) {
      let errorMessage = error.message;
      let hint = "";
      let availableMethods: any[] = [];

      // Try to fetch reasoning engine details for better debugging
      try {
        const adminClient = new ReasoningEngineServiceClient(clientConfig);
        const [engine] = await adminClient.getReasoningEngine({ name: `projects/${project}/locations/${location}/reasoningEngines/${reasoningEngineId}` });
        console.log("Fetched Reasoning Engine Details:", JSON.stringify(engine, null, 2));
        if (engine.spec && (engine.spec as any).classMethods) {
          availableMethods = (engine.spec as any).classMethods;
        }
      } catch (adminError) {
        console.warn("Could not fetch reasoning engine details:", adminError);
      }
      
      if (errorMessage.includes("method `query` not found")) {
        hint = "The Reasoning Engine exists but does not expose a 'query' method. Available methods from spec: " + 
               (availableMethods.length > 0 ? availableMethods.map(m => m.name || JSON.stringify(m)).join(", ") : "None found in spec");
      }

      console.error("Detailed Error in /api/agent-chat:", {
        message: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details,
        hint
      });
      res.status(500).json({ 
        error: errorMessage,
        details: error.stack,
        code: error.code,
        serviceAccount: (req as any).currentIdentity || "Unknown",
        hint
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

