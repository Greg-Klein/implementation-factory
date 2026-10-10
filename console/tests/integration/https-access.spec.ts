import { expect, test } from "@playwright/test";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { request } from "node:https";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { controlToken } from "../fixtures";

const exec = promisify(execFile);
test("should authenticate HTTPS clients and pin the local hook certificate", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "impl-https-test-"));
  const cert = path.join(directory, "cert.pem"), key = path.join(directory, "key.pem");
  let server: ReturnType<typeof spawn> | undefined;
  try {
    await exec("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=console.example", "-addext", "subjectAltName=DNS:console.example", "-keyout", key, "-out", cert]);
    server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { cwd: process.cwd(), env: {
      ...process.env, NODE_ENV: "production", PORT: "0", IMPL_HOST: "127.0.0.1", IMPL_PUBLIC_URL: "", IMPL_ENV_FILE: path.join(directory, "absent.env"),
      IMPL_HOOK_TOKEN: "https-hook-secret", IMPL_DATA_DIR: path.join(directory, "data"), IMPL_CONTROL_TOKEN: controlToken, IMPL_TLS_CERT: cert, IMPL_TLS_KEY: key,
      IMPL_SELF_IMPROVEMENT_AUTORUN: "false", IMPL_SEARCH_ROOTS: path.join(directory, "empty"),
      IMPL_TICKET_PROPOSALS_FILE: path.join(directory, "absent.json"),
    }, stdio: ["ignore", "pipe", "pipe"] });
    const child = server;
    const base = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error(`HTTPS startup timed out: ${output.slice(-1000)}`)), 15_000);
      child.stdout!.on("data", (data) => { output += data; const address = /Implementation Factory: (https:\/\/[^\s]+)/.exec(output)?.[1]; if (address) { clearTimeout(timer); resolve(address); } });
      child.stderr!.on("data", (data) => { output += data; });
      child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`HTTPS server exited ${code}: ${output.slice(-1000)}`)); });
    });
    const ca = await readFile(cert);
    const get = (authorized: boolean) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const outgoing = request(`${base}/api/runs`, { ca, servername: "console.example", headers: authorized ? { Authorization: `Bearer ${controlToken}` } : {} }, (response) => {
        let body = ""; response.on("data", (data) => { body += data; }); response.on("end", () => resolve({ status: response.statusCode!, body }));
      }); outgoing.on("error", reject); outgoing.end();
    });
    expect((await get(false)).status).toBe(401);
    expect((await get(true)).status).toBe(200);
    const token = await readFile(path.join(directory, "data/control-token"), "utf8");
    expect(token).toBe(controlToken);
    const hookToken = "https-hook-secret";
    const spool = path.join(directory, "spool.jsonl");
    const emitter = spawn(process.execPath, [path.resolve(process.cwd(), "../hooks/emit.mjs")], { cwd: directory, env: {
      ...process.env, IMPL_HOOK_URL: `${base}/api/hooks?token=${hookToken}`, IMPL_HOOK_TLS_CERT: cert, IMPL_HOOK_SPOOL: spool, IMPL_RUN_ID: "https-test-run",
    }, stdio: ["pipe", "pipe", "pipe"] });
    emitter.stdin!.end(JSON.stringify({ hook_event_name: "Notification", cwd: directory }));
    await new Promise<void>((resolve, reject) => { emitter.once("error", reject); emitter.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Hook exited ${code}`))); });
    await expect(stat(spool)).rejects.toThrow();
  } finally {
    if (server && server.exitCode === null) { server.kill("SIGTERM"); await new Promise<void>((resolve) => { const timer = setTimeout(() => { server?.kill("SIGKILL"); resolve(); }, 10_000); server!.once("exit", () => { clearTimeout(timer); resolve(); }); }); }
    await rm(directory, { recursive: true, force: true });
  }
});
