import { describe, expect, it } from "@jest/globals";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

const launcherPath = path.resolve(process.cwd(), "..", "bin", "implementation-factory");
const source = readFileSync(launcherPath, "utf8");

function launch(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("bash", [launcherPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 20_000,
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function available(command: string) {
  return spawnSync("bash", ["-c", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

/** A port nothing listens on, so a real execution is never touched. */
async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

function listenInChildProcess(port: number) {
  return spawn("node", ["-e", `require("http").createServer((_, response) => response.end("ok")).listen(${port}, "127.0.0.1")`], { stdio: "ignore" });
}

function waitForExit(child: ChildProcess, timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(true); });
  });
}

describe("implementation-factory launcher", () => {
  it("should be valid bash", () => {
    expect(() => execFileSync("bash", ["-n", launcherPath])).not.toThrow();
  });

  it("should document every subcommand it accepts", () => {
    const { code, stdout } = launch(["help"]);
    expect(code).toBe(0);
    for (const subcommand of ["start", "demo", "restart", "stop", "status", "config", "improve", "help"]) {
      expect(stdout).toContain(subcommand);
    }
  });

  it("should document the commands that drive the runs from the terminal", () => {
    const { stdout } = launch(["help"]);
    for (const subcommand of ["run", "runs", "show", "watch", "attach", "answer", "trust", "tell", "abort", "close", "feedback", "queue", "incident", "worktree", "docs", "evidence", "metrics", "recipe", "findings", "proposals", "improvements", "repos"]) {
      expect(stdout).toMatch(new RegExp(`^  ${subcommand} `, "m"));
    }
  });

  it("should hand a terminal command to the client, which lists the same commands", () => {
    const { code, stdout } = launch(["runs", "--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("runs [--json]");
  });

  it("should say no console answers, with the exit code of a stopped server, instead of starting one to read from", async () => {
    const port = await freePort();
    const { code, stderr } = launch(["runs"], { IMPL_PORT: String(port), IMPL_CONSOLE_URL: "" });
    expect(code).toBe(3);
    expect(stderr).toContain(`No Implementation Factory console answers at http://127.0.0.1:${port}`);
  });

  it("should reach the console IMPL_CONSOLE_URL names rather than the local port", async () => {
    const port = await freePort();
    const { code, stderr } = launch(["runs"], { IMPL_PORT: "3210", IMPL_CONSOLE_URL: `http://127.0.0.1:${port}` });
    expect(code).toBe(3);
    expect(stderr).toContain(`http://127.0.0.1:${port}`);
  });

  it("should refuse a terminal command written wrong with the exit code of a usage error", () => {
    const { code, stderr } = launch(["queue", "--nope"]);
    expect(code).toBe(2);
    expect(stderr).toContain("--nope");
  });

  it("should print the usage on --help and -h as well", () => {
    for (const flag of ["--help", "-h"]) {
      const { code, stdout } = launch([flag]);
      expect(code).toBe(0);
      expect(stdout).toContain("Usage:");
    }
  });

  it("should refuse an unknown command instead of starting the server", async () => {
    const port = await freePort();
    const { code, stderr } = launch(["statut"], { IMPL_PORT: String(port), IMPL_NO_OPEN: "1" });
    expect(code).toBe(1);
    expect(stderr).toContain("Unknown command: statut");
  });

  it("should refuse extra arguments", async () => {
    const port = await freePort();
    const { code, stderr } = launch(["demo", "extra"], { IMPL_PORT: String(port), IMPL_NO_OPEN: "1" });
    expect(code).toBe(1);
    expect(stderr).toContain("Too many arguments");
  });

  it("should report a quiet port on stop", async () => {
    const port = await freePort();
    const { code, stdout } = launch(["stop"], { IMPL_PORT: String(port) });
    expect(code).toBe(0);
    expect(stdout).toContain("No Implementation Factory server");
  });

  it("should report a stopped server with its own exit code", async () => {
    const port = await freePort();
    const { code, stdout } = launch(["status"], { IMPL_PORT: String(port) });
    // 3 tells "stopped" from a usage error, which exits with 1.
    expect(code).toBe(3);
    expect(stdout).toContain("Stopped");
  });

  const canInspectPorts = available("lsof");

  (canInspectPorts ? it : it.skip)("should fail the status when the port answers but the factory does not", async () => {
    const port = await freePort();
    const child = listenInChildProcess(port);
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      const { code, stderr } = launch(["status"], { IMPL_PORT: String(port) });
      expect(code).toBe(1);
      expect(stderr).toContain("/api/runs");
    } finally {
      child.kill("SIGKILL");
    }
  }, 20_000);

  (canInspectPorts ? it : it.skip)("should reject a bad restart argument before stopping anything", async () => {
    const port = await freePort();
    const child = listenInChildProcess(port);
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      const { code, stderr } = launch(["restart", "bogus"], { IMPL_PORT: String(port), IMPL_NO_OPEN: "1" });
      expect(code).toBe(1);
      expect(stderr).toContain("restart only accepts the demo mode");
      // A refused invocation must not leave the server stopped behind it.
      expect(await waitForExit(child, 500)).toBe(false);
    } finally {
      child.kill("SIGKILL");
    }
  }, 20_000);

  (canInspectPorts ? it : it.skip)("should free the port on stop", async () => {
    const port = await freePort();
    const child = listenInChildProcess(port);
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      const { code, stdout } = launch(["stop"], { IMPL_PORT: String(port) });
      expect(code).toBe(0);
      expect(stdout).toContain("Stopping the Implementation Factory server");
      // Le contrat de restart : un serveur en cours sert le manifeste Next.js de
      // son propre build, donc il doit disparaitre avant qu'un autre demarre.
      expect(await waitForExit(child, 5_000)).toBe(true);
    } finally {
      child.kill("SIGKILL");
    }
  }, 20_000);

  function envFile(content: string) {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), "impl-launcher-")), ".env");
    writeFileSync(file, content);
    return file;
  }

  it("should read the port from the .env file when the shell defines none", () => {
    const { code, stdout } = launch(["status"], { IMPL_ENV_FILE: envFile("IMPL_PORT='4399'\n"), IMPL_PORT: "" });
    expect(code).toBe(3);
    expect(stdout).toContain("4399");
  });

  it("should let a shell variable win over the .env file", async () => {
    const port = await freePort();
    const { stdout } = launch(["status"], { IMPL_ENV_FILE: envFile("IMPL_PORT='4399'\n"), IMPL_PORT: String(port) });
    expect(stdout).toContain(String(port));
    expect(stdout).not.toContain("4399");
  });

  it("should ignore quotes and inline comments in the .env file", () => {
    const { stdout } = launch(["status"], { IMPL_ENV_FILE: envFile("IMPL_PORT=4399 # le port\n"), IMPL_PORT: "" });
    expect(stdout).toContain("4399");
  });

  it("should keep the last assignment when a key is defined twice", () => {
    const { stdout } = launch(["status"], { IMPL_ENV_FILE: envFile("IMPL_PORT='1111'\nIMPL_PORT='4399'\n"), IMPL_PORT: "" });
    expect(stdout).toContain("4399");
    expect(stdout).not.toContain("1111");
  });

  it("should never execute the .env file", () => {
    const marker = path.join(mkdtempSync(path.join(os.tmpdir(), "impl-trap-")), "executed");
    const file = envFile(`IMPL_PORT='4399'\nPIEGE="$(touch ${marker})"\n`);
    const { stdout } = launch(["status"], { IMPL_ENV_FILE: file, IMPL_PORT: "" });
    expect(stdout).toContain("4399");
    // Sourcing the file would have run the substitution and created the marker.
    expect(existsSync(marker)).toBe(false);
  });

  it("should take the listening host from the .env file", () => {
    const { stdout } = launch(["help"], { IMPL_ENV_FILE: envFile("IMPL_HOST='0.0.0.0'\nIMPL_PORT='4399'\n"), IMPL_PORT: "", IMPL_HOST: "" });
    expect(stdout).toContain("in effect: 0.0.0.0");
    expect(stdout).toContain("in effect: 4399");
  });

  it("should fall back to the default port when the .env file is missing", () => {
    const { stdout } = launch(["status"], { IMPL_ENV_FILE: "/nonexistent/impl.env", IMPL_PORT: "" });
    expect(stdout).toContain("3210");
  });

  it("should print the configuration instead of prompting when there is no terminal", () => {
    const { code, stdout } = launch(["config"], { IMPL_ENV_FILE: envFile("IMPL_PORT='4399'\n"), IMPL_PORT: "" });
    expect(code).toBe(0);
    expect(stdout).toContain("IMPL_PORT");
  });

  it("should pass its own arguments through to the config command", () => {
    const { code, stdout } = launch(["config", "get", "IMPL_PORT"], { IMPL_ENV_FILE: envFile("IMPL_PORT='4399'\n"), IMPL_PORT: "" });
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("4399");
  });

  it("should not reference the former project name", () => {
    expect(source).not.toMatch(/x-implement|ximpl|X_IMPLEMENT_/);
  });
});
