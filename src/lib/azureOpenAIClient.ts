import { AzureOpenAI } from "openai";

// Server-side only. The API key is never read by, or exposed to, any
// client-facing code. In production it arrives as an app setting resolved
// from Key Vault via a Key Vault reference — this code just reads
// process.env like any other setting and never talks to Key Vault directly.
const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_API_KEY;
const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21";

export const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-5-mini";

let client: AzureOpenAI | null = null;

export function isAzureOpenAIConfigured(): boolean {
  return Boolean(endpoint && apiKey);
}

export function getAzureOpenAIClient(): AzureOpenAI | null {
  if (!isAzureOpenAIConfigured()) return null;
  if (!client) {
    client = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment: AZURE_OPENAI_DEPLOYMENT });
  }
  return client;
}

/**
 * Wraps a promise with an explicit timeout so a slow/hanging Azure OpenAI
 * call never blocks a function invocation — callers treat a timeout the
 * same as any other failure and fall back accordingly.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Azure OpenAI call timed out after ${ms}ms`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
