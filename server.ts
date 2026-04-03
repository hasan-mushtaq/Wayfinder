import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { Spanner } from "@google-cloud/spanner";
import cors from "cors";

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
  properties: {
    node_id: string;
    name: string;
    category: string;
  };
}

interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

// --- Global Error Handlers to suppress background Spanner metrics errors ---
process.on("unhandledRejection", (reason: any) => {
  // Suppress "Send TimeSeries failed" background errors from Spanner
  if (reason?.message?.includes("Send TimeSeries failed") || reason?.message?.includes("monitoring metric writer permission")) {
    console.warn("Suppressed background Spanner metrics error:", reason.message);
    return;
  }
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error: any) => {
  // Suppress "Send TimeSeries failed" background errors from Spanner
  if (error?.message?.includes("Send TimeSeries failed") || error?.message?.includes("monitoring metric writer permission")) {
    console.warn("Suppressed background Spanner metrics error:", error.message);
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
      const query = {
        sql: `
          SELECT 
            node_id, 
            name, 
            category, 
            geom as geom_geojson
          FROM Map_Nodes
          WHERE floor_number = '1'
        `,
      };
  

      const [rows] = await database.run(query);
      
      const features: GeoJSONFeature[] = rows.map((row: any) => {
        const spannerRow = row.toJSON() as SpannerRow;
        return {
          type: "Feature",
          geometry: JSON.parse(spannerRow.geom_geojson),
          properties: {
            node_id: spannerRow.node_id,
            name: spannerRow.name,
            category: spannerRow.category,
          },
        };
      });

      res.json({
        type: "FeatureCollection",
        features: features,
        source: "spanner"
      });
    } catch (error: any) {
      console.error("Spanner unavailable, falling back to mock data:", error.message);
      
      // --- Mock Data Fallback for Preview/Testing ---
      const mockFeatures: GeoJSONFeature[] = [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-121.888, 37.329] },
          properties: { node_id: "m1", name: "Main Entrance", category: "facility" }
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-121.8885, 37.3295] },
          properties: { node_id: "e1", name: "T-Rex Exhibit", category: "exhibit" }
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-121.8875, 37.3285] },
          properties: { node_id: "f1", name: "Cafe & Restrooms", category: "facility" }
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-121.889, 37.330] },
          properties: { node_id: "e2", name: "Space Gallery", category: "exhibit" }
        }
      ];

      res.json({
        type: "FeatureCollection",
        features: mockFeatures,
        source: "mock",
        warning: "Using mock data because Spanner API is disabled or unreachable in this environment."
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
    // Serve static files in production
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    
    // SPA fallback
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
