import { describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const binRoot = path.resolve(process.cwd(), "..", "bin");

/**
 * Jest transpiles to CommonJS and cannot require an .mjs module, so the writer
 * is exercised through a child process, the same way the launcher is.
 */
function edit(text: string, edits: Record<string, string>) {
  const script = `
    import { applyEdits } from ${JSON.stringify(path.join(binRoot, "env-file.mjs"))};
    import { schema } from ${JSON.stringify(path.join(binRoot, "env-schema.mjs"))};
    process.stdout.write(applyEdits(${JSON.stringify(text)}, ${JSON.stringify(edits)}, schema));
  `;
  return execFileSync("node", ["--input-type=module", "-e", script], { encoding: "utf8" });
}

/**
 * The child inherits this process's environment and process.loadEnvFile never
 * overrides a variable that is already set. Any test importing the server
 * modules loads the developer .env into process.env, so the settings under test
 * are cleared here or that .env would decide what this test reads back.
 */
function isolatedEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (key.startsWith("IMPL_")) delete environment[key];
  return environment;
}

function readBack(text: string) {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "impl-env-")), ".env");
  writeFileSync(file, text);
  const script = `
    process.loadEnvFile(${JSON.stringify(file)});
    const { readFileSync } = await import("node:fs");
    const { readValues } = await import(${JSON.stringify(path.join(binRoot, "env-file.mjs"))});
    const parsed = readValues(readFileSync(${JSON.stringify(file)}, "utf8"));
    const loaded = Object.fromEntries(Object.keys(parsed).map((key) => [key, process.env[key]]));
    process.stdout.write(JSON.stringify({ parsed, loaded }));
  `;
  return JSON.parse(execFileSync("node", ["--input-type=module", "-e", script], { encoding: "utf8", env: isolatedEnvironment() }));
}

describe("env file writer", () => {
  it("should update a key in place without touching comments or order", () => {
    const original = "# garde-moi\nIMPL_PORT='3210'\n\n# et moi\nIMPL_HOST='127.0.0.1'\n";
    expect(edit(original, { IMPL_PORT: "4321" })).toBe("# garde-moi\nIMPL_PORT='4321'\n\n# et moi\nIMPL_HOST='127.0.0.1'\n");
  });

  it("should append a missing key with the comment from the schema", () => {
    const written = edit("IMPL_PORT='3210'\n", { IMPL_HOST: "0.0.0.0" });
    expect(written).toContain("# Network interface the local server binds to.\nIMPL_HOST='0.0.0.0'\n");
    expect(written).toContain("IMPL_PORT='3210'");
  });

  it("should keep an export prefix and a hand-written unknown key", () => {
    const original = "MON_TRUC=maison\nexport IMPL_PORT=3210 # le port\n";
    expect(edit(original, { IMPL_PORT: "4321" })).toBe("MON_TRUC=maison\nexport IMPL_PORT='4321'\n");
  });

  it("should update only the last assignment, like process.loadEnvFile", () => {
    const original = "IMPL_PORT='1111'\nIMPL_PORT='2222'\n";
    expect(edit(original, { IMPL_PORT: "3333" })).toBe("IMPL_PORT='1111'\nIMPL_PORT='3333'\n");
  });

  it("should rewrite an identical value byte for byte", () => {
    const original = "IMPL_PORT='3210'\n";
    expect(edit(original, { IMPL_PORT: "3210" })).toBe(original);
  });

  it("should quote a value containing an apostrophe with double quotes", () => {
    expect(edit("", { IMPL_SEARCH_ROOTS: "~/l'atelier" })).toContain(`IMPL_SEARCH_ROOTS="~/l'atelier"`);
  });

  it("should append the worktree settings with their comment, and keep a pattern with a star as written", () => {
    const written = edit("IMPL_PORT='3210'\n", { IMPL_WORKTREE_COPY_FILES: ".env*,config/local.json", IMPL_WORKTREE_DEPENDENCY_DIRS: "node_modules,vendor" });
    expect(written).toContain("IMPL_WORKTREE_COPY_FILES='.env*,config/local.json'\n");
    expect(written).toContain("IMPL_WORKTREE_DEPENDENCY_DIRS='node_modules,vendor'\n");
    expect(written).toMatch(/# Comma-separated names of ignored dependency directories[^\n]*\nIMPL_WORKTREE_DEPENDENCY_DIRS=/);
    expect(readBack(written).loaded).toMatchObject({ IMPL_WORKTREE_COPY_FILES: ".env*,config/local.json", IMPL_WORKTREE_DEPENDENCY_DIRS: "node_modules,vendor" });
  });

  it("should read back through loadEnvFile exactly what it wrote", () => {
    const written = edit("", { IMPL_SEARCH_ROOTS: "~/l'atelier,~/workspace", IMPL_HOST: "0.0.0.0" });
    const { parsed, loaded } = readBack(written);
    expect(parsed).toEqual({ IMPL_SEARCH_ROOTS: "~/l'atelier,~/workspace", IMPL_HOST: "0.0.0.0" });
    expect(loaded).toEqual(parsed);
  });
});
