import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { Spanner } from "@google-cloud/spanner";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Spanner Configuration ---
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
const instanceId = "indoor-routing";
const databaseId = "routing";

// Initialize Spanner with metrics disabled to avoid permission issues
const spanner = new Spanner({ 
  projectId,
  // Disable client-side metrics to prevent "Send TimeSeries failed" errors
  // if the service account lacks monitoring.metricWriter permissions.
  clientSideMetricsConfig: { enabled: false }
});
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
            ST_ASGEOJSON(geom) as geom_geojson
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

      const featureCollection: GeoJSONFeatureCollection = {
        type: "FeatureCollection",
        features: features,
      };

      res.json(featureCollection);
    } catch (error) {
      console.error("Error querying Spanner:", error);
      res.status(500).json({ error: "Failed to fetch map data from Spanner" });
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
