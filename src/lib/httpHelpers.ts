import { HttpResponseInit } from "@azure/functions";

export function json(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    jsonBody: body,
  };
}

export function badRequest(message: string): HttpResponseInit {
  return json(400, { error: message });
}
