import { CosmosClient, Container } from "@azure/cosmos";

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DATABASE ?? "seen-db";
const containerId = process.env.COSMOS_CONTAINER ?? "entries";

let client: CosmosClient | null = null;
let containerRef: Container | null = null;

export function isCosmosConfigured(): boolean {
  return Boolean(endpoint && key);
}

export function getContainer(): Container {
  if (!endpoint || !key) {
    throw new Error("COSMOS_ENDPOINT and COSMOS_KEY must be configured");
  }
  if (!containerRef) {
    client = new CosmosClient({ endpoint, key });
    containerRef = client.database(databaseId).container(containerId);
  }
  return containerRef;
}
