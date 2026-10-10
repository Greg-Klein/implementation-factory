import { request } from "@playwright/test";
import path from "node:path";
import { controlToken, dataDirectory } from "./fixtures";

export default async function authenticateSuite() {
  const client = await request.newContext({ baseURL: "http://127.0.0.1:3211" });
  try {
    const response = await client.post("/api/auth/session", { headers: { Authorization: `Bearer ${controlToken}` } });
    if (!response.ok()) throw new Error(`Test association failed: ${response.status()}`);
    await client.storageState({ path: path.join(dataDirectory, "browser-auth.json") });
  } finally { await client.dispose(); }
}
