
import { ReasoningEngineServiceClient } from "@google-cloud/aiplatform";

async function listEngines() {
  const client = new ReasoningEngineServiceClient({
    apiEndpoint: "us-central1-aiplatform.googleapis.com",
  });

  const parent = "projects/464794370950/locations/us-central1";

  try {
    console.log(`Listing Reasoning Engines in ${parent}...`);
    const [engines] = await client.listReasoningEngines({ parent });
    console.log("Found Engines:");
    engines.forEach(e => {
      console.log(`- ID: ${e.name?.split('/').pop()}, Display Name: ${e.displayName}`);
    });
  } catch (error) {
    console.error("Error listing reasoning engines:", error);
  }
}

listEngines();
