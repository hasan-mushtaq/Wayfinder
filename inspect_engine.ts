
import { ReasoningEngineServiceClient } from "@google-cloud/aiplatform";

async function inspect() {
  const client = new ReasoningEngineServiceClient({
    apiEndpoint: "us-central1-aiplatform.googleapis.com",
  });

  const name = "projects/464794370950/locations/us-central1/reasoningEngines/1865942150835863552";

  try {
    const [response] = await client.getReasoningEngine({ name });
    console.log("Reasoning Engine Details:");
    console.log(JSON.stringify(response, null, 2));
  } catch (error) {
    console.error("Error getting reasoning engine:", error);
  }
}

inspect();
