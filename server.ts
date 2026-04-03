import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { Spanner } from "@google-cloud/spanner";
import cors from "cors";
import wellknown from "wellknown";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      const geojsonDir = path.join(__dirname, "src", "data", "geojson");
      const levelFilePath = path.join(geojsonDir, "level.geojson");
      
      if (fs.existsSync(levelFilePath)) {
        const content = fs.readFileSync(levelFilePath, "utf8");
        const geojson = JSON.parse(content);
        
        if (geojson.features) {
          const levels = geojson.features.map((f: any) => ({
            id: f.id,
            name: f.properties.name?.en || f.properties.name || "Unnamed Level",
            short_name: f.properties.short_name?.en || f.properties.short_name || "",
            ordinal: f.properties.ordinal ?? 0
          })).sort((a: any, b: any) => a.ordinal - b.ordinal);
          
          return res.json(levels);
        }
      }
      
      res.json([]);
    } catch (error: any) {
      console.error("Error in /api/levels:", error.message);
      res.status(500).json({ error: error.message });
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

