import { BlobServiceClient, ContainerClient, RestError } from "@azure/storage-blob";
import { DailyEntry } from "../types";

// Reuses the Function App's own storage account (the one Azure Functions
// already requires for its runtime) rather than provisioning a separate
// database for a prototype-scale entry log.
const connectionString = process.env.AzureWebJobsStorage ?? process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.ENTRIES_CONTAINER ?? "seen-data";
const blobName = process.env.ENTRIES_BLOB_NAME ?? "entries.json";

let containerClientPromise: Promise<ContainerClient> | null = null;

function getContainerClient(): Promise<ContainerClient> {
  if (!connectionString) {
    throw new Error("AzureWebJobsStorage (or AZURE_STORAGE_CONNECTION_STRING) is not configured");
  }
  if (!containerClientPromise) {
    containerClientPromise = (async () => {
      const serviceClient = BlobServiceClient.fromConnectionString(connectionString);
      const container = serviceClient.getContainerClient(containerName);
      await container.createIfNotExists();
      return container;
    })();
  }
  return containerClientPromise;
}

async function readEntriesWithEtag(): Promise<{ entries: DailyEntry[]; etag: string | undefined }> {
  const container = await getContainerClient();
  const blockBlob = container.getBlockBlobClient(blobName);
  const exists = await blockBlob.exists();
  if (!exists) return { entries: [], etag: undefined };

  const props = await blockBlob.getProperties();
  const download = await blockBlob.downloadToBuffer();
  try {
    return { entries: JSON.parse(download.toString("utf-8")) as DailyEntry[], etag: props.etag };
  } catch {
    return { entries: [], etag: props.etag };
  }
}

export async function loadEntries(): Promise<DailyEntry[]> {
  const { entries } = await readEntriesWithEtag();
  return entries;
}

/**
 * Saves an entry, replacing any existing entry for the same date. Uses an
 * ETag-conditional upload with a short retry loop so two near-simultaneous
 * writes don't silently clobber each other (blob storage has no native
 * read-modify-write primitive).
 */
export async function saveEntry(entry: DailyEntry): Promise<DailyEntry> {
  const container = await getContainerClient();
  const blockBlob = container.getBlockBlobClient(blobName);
  const MAX_RETRIES = 5;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { entries, etag } = await readEntriesWithEtag();
    const next = entries.filter((e) => e.date !== entry.date);
    next.push(entry);
    const payload = Buffer.from(JSON.stringify(next, null, 2), "utf-8");

    try {
      await blockBlob.upload(payload, payload.length, {
        conditions: etag ? { ifMatch: etag } : { ifNoneMatch: "*" },
        blobHTTPHeaders: { blobContentType: "application/json" },
      });
      return entry;
    } catch (err) {
      const isConflict = err instanceof RestError && err.statusCode === 412;
      if (isConflict && attempt < MAX_RETRIES - 1) continue;
      throw err;
    }
  }

  throw new Error("Failed to save entry after repeated concurrent write conflicts");
}

export async function clearEntries(): Promise<void> {
  const container = await getContainerClient();
  const blockBlob = container.getBlockBlobClient(blobName);
  const payload = Buffer.from("[]", "utf-8");
  await blockBlob.upload(payload, payload.length, {
    blobHTTPHeaders: { blobContentType: "application/json" },
  });
}
