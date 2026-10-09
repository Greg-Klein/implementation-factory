import { describe, expect, it } from "@jest/globals";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const pluginRoot = path.resolve(process.cwd(), "..");
/** The layout Claude Code reads from a plugin. */
const pluginDirectories = [".claude-plugin", "agents", "commands", "hooks", "skills"];

function definitions(directory: "agents" | "commands") {
  return readdirSync(path.join(pluginRoot, directory))
    .filter((file) => file.endsWith(".md"))
    .map((file) => path.join(pluginRoot, directory, file));
}

function skills() {
  return readdirSync(path.join(pluginRoot, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(pluginRoot, "skills", entry.name, "SKILL.md"));
}

function frontmatter(file: string) {
  const source = readFileSync(file, "utf8");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  expect(match).not.toBeNull();
  return parse(match?.[1] ?? "") as Record<string, unknown>;
}

describe("Claude Code plugin metadata", () => {
  it("should parse every agent and command frontmatter", () => {
    for (const file of [...definitions("agents"), ...definitions("commands")]) {
      const metadata = frontmatter(file);
      expect(metadata.name).toEqual(expect.any(String));
      expect(metadata.description).toEqual(expect.any(String));
    }
  });

  it("should name every skill after the directory it is loaded from", () => {
    const files = skills();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const metadata = frontmatter(file);
      expect(metadata.name).toBe(path.basename(path.dirname(file)));
      expect(metadata.description).toEqual(expect.any(String));
    }
  });

  it("should keep every plugin directory at the root of the checkout", () => {
    for (const directory of pluginDirectories) expect(existsSync(path.join(pluginRoot, directory))).toBe(true);
  });

  it("should identify Gregory Klein as the plugin author", () => {
    const manifest = JSON.parse(readFileSync(path.join(pluginRoot, ".claude-plugin/plugin.json"), "utf8"));
    expect(manifest.author).toEqual({ name: "Gregory Klein" });
  });

  it("should keep every improvement on its own branch until the user approves it", () => {
    const improve = readFileSync(path.join(pluginRoot, "commands", "improve.md"), "utf8");
    // Le panneau de la console est la seule porte de promotion. Une commande qui
    // fusionne elle-meme presenterait un changement deja applique a la validation,
    // et le rejet ne reviendrait alors sur rien.
    expect(improve).not.toMatch(/AUTO_APPLY|PRIMARY_CHECKOUT/);
    expect(improve).toMatch(/Never merge it into the primary checkout/);
    // Mettre la branche d'amelioration a niveau sur le harnais est l'inverse d'une
    // promotion : la fusion va vers la branche, jamais vers le checkout, et
    // `--ff-only` refuse des que la branche porte un commit a elle. Epingler la
    // liste complete interdit toute autre forme, `--no-ff` comprise.
    expect(improve.match(/git merge [^\n`]*/g)).toEqual(["git merge --ff-only main"]);
  });

  it("should publish its commands under the implementation-factory namespace", () => {
    const manifest = JSON.parse(readFileSync(path.join(pluginRoot, ".claude-plugin/plugin.json"), "utf8"));
    expect(manifest.name).toBe("implementation-factory");
    const names = definitions("commands").map((file) => frontmatter(file).name);
    expect(names.sort()).toEqual(["implement", "improve", "judge-improvement", "rebase", "review", "schedule"]);
  });
});
