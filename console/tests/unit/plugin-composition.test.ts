import { describe, expect, it } from "@jest/globals";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { parseCriteriaRegistry, parseEvidenceReport, parsePlanLinks } from "../../server/acceptance";
import { isRunDocument, phaseForArtifact, plannedTasks } from "../../server/domain";

const root = path.resolve(process.cwd(), "..");
const namespace = JSON.parse(readFileSync(path.join(root, ".claude-plugin/plugin.json"), "utf8")).name as string;

function markdown(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? markdown(file) : entry.name.endsWith(".md") ? [file] : [];
  });
}

function metadata(file: string): Record<string, unknown> {
  const match = readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error(`Missing metadata: ${file}`);
  return parse(match[1]);
}

function example(contract: string): Record<string, unknown> {
  const source = readFileSync(path.join(root, "contracts", `${contract}.md`), "utf8");
  const match = source.match(/```json\n([\s\S]*?)\n```/);
  if (!match) throw new Error(`Missing JSON example: ${contract}`);
  return JSON.parse(match[1]);
}

describe("plugin composition", () => {
  const definitions = ["agents", "commands", "skills", "contracts", "principles"].flatMap((directory) => markdown(path.join(root, directory)));
  const skills = new Map(markdown(path.join(root, "skills")).filter((file) => path.basename(file) === "SKILL.md")
    .map((file) => [`${namespace}:${metadata(file).name}`, file]));

  it("should resolve instruction links from the plugin instead of the target checkout", () => {
    const missing: string[] = [];
    for (const file of definitions) {
      const prose = readFileSync(file, "utf8").replace(/```[^\n]*\n[\s\S]*?```/g, "");
      for (const match of prose.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1].split("#")[0];
        if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
        const resolved = target.startsWith("${CLAUDE_PLUGIN_ROOT}/")
          ? path.join(root, target.slice("${CLAUDE_PLUGIN_ROOT}/".length))
          : path.resolve(path.dirname(file), target);
        if (!existsSync(resolved)) missing.push(`${path.relative(root, file)} -> ${target}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("should resolve every declared skill preload to an invocable skill", () => {
    for (const file of markdown(path.join(root, "agents"))) {
      for (const name of (metadata(file).skills ?? []) as string[]) {
        expect(skills.has(name)).toBe(true);
        expect(metadata(skills.get(name)!)['disable-model-invocation']).not.toBe(true);
      }
    }
  });

  it("should resolve qualified skill calls advertised in agent methods", () => {
    const missing = new Set<string>();
    const agentNames = new Set(markdown(path.join(root, "agents")).map((file) => `${namespace}:${metadata(file).name}`));
    for (const file of definitions) {
      for (const match of readFileSync(file, "utf8").matchAll(/`(implementation-harness:[a-z][a-z-]*)`/g)) {
        if (!skills.has(match[1]) && !agentNames.has(match[1])) missing.add(match[1]);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("should keep how and why references distributable within their own folders", () => {
    for (const name of ["how", "why"]) {
      const directory = path.join(root, "skills", name);
      expect(existsSync(path.join(directory, "references/epistemics.md"))).toBe(true);
      for (const file of markdown(directory)) {
        for (const match of readFileSync(file, "utf8").matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
          if (/^https?:/.test(match[1])) continue;
          const relative = path.relative(directory, path.resolve(path.dirname(file), match[1]));
          expect(relative.startsWith("..")).toBe(false);
        }
      }
    }
  });
});

describe("extracted artifact contracts", () => {
  it("should keep registry and planner examples consumable by the console", () => {
    const registry = parseCriteriaRegistry(example("acceptance-criteria"));
    expect(registry.diagnostics).toEqual([]);
    expect(registry.registry?.criteria[0].id).toBe("AC1");
    const plan = example("planner");
    expect(parsePlanLinks(plan)?.tasks[0].criterionIds).toEqual(["AC1"]);
    expect(plannedTasks(JSON.stringify(plan))?.[0].id).toBe("T1");
  });

  it.each([
    ["developer", "dev-evidence-T1.json", "developer", "reported"],
    ["qa", "qa-evidence.json", "qa", "observed"],
    ["design", "design-evidence.json", "design", "observed"],
    ["pilot-evidence", "qa-evidence.json", "qa", "observed"],
  ])("should preserve %s evidence after extraction", (contract, file, source, basis) => {
    const value = example(contract);
    // Instantiate the documented enum alternatives and caller-supplied identifiers.
    value.status = "PASS";
    if (!Array.isArray(value.items)) throw new Error(`Missing items in ${contract}`);
    const items = value.items.map((item: Record<string, unknown>, index: number) => ({
      ...item, id: `E${index + 1}`, verdict: source === "developer" ? "measured" : "pass",
      method: "browser", taskIds: ["T1"], confirms: undefined, supersedes: [],
      codeSnapshotId: "snap-final", codeSnapshotAtEnd: "snap-final",
    }));
    value.items = items;
    const parsed = parseEvidenceReport(value, { file, version: 1, receivedAt: "2026-09-30T12:00:00Z", hash: "contract" });
    expect(parsed.diagnostics).toEqual([]);
    if (!("records" in parsed)) throw new Error(`Unreadable ${contract} contract`);
    expect(parsed.source).toBe(source);
    expect(parsed.records).toHaveLength(items.length);
    expect(parsed.records[0].view.basis).toBe(basis);
    expect(parsed.records[0].snapshotAtStart).toBe("snap-final");
    expect(parsed.records[0].snapshotAtEnd).toBe("snap-final");
  });

  it("should keep the schedule example valid under the rules its own contract states", () => {
    const source = readFileSync(path.join(root, "contracts", "schedule.md"), "utf8");
    const [input, output] = [...source.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => JSON.parse(match[1]));
    const requested = input.tickets.map((ticket: { issue_url: string }) => ticket.issue_url);
    const known = input.known.map((ticket: { issue_url: string }) => ticket.issue_url);
    expect(output.tickets.map((ticket: { issue_url: string }) => ticket.issue_url)).toEqual(requested);
    for (const ticket of output.tickets) {
      expect(["low", "medium", "high"]).toContain(ticket.confidence);
      expect(ticket.summary).not.toBe("");
    }
    const pairs = new Set<string>();
    for (const edge of output.edges) {
      expect(edge.a).not.toBe(edge.b);
      expect([...requested, ...known]).toEqual(expect.arrayContaining([edge.a, edge.b]));
      expect(requested.includes(edge.a) || requested.includes(edge.b)).toBe(true);
      if (edge.kind === "depends_on") expect([...edge.order].sort()).toEqual([edge.a, edge.b].sort());
      else expect(edge).toEqual(expect.objectContaining({ kind: "overlap" }));
      if (edge.kind === "overlap") expect(edge.order).toBeUndefined();
      expect(edge.reason).not.toBe("");
      const pair = [edge.a, edge.b].sort().join(" ");
      expect(pairs.has(pair)).toBe(false);
      pairs.add(pair);
    }
    // The example has to exercise both kinds, or the console would be built against half a contract.
    expect(output.edges.map((edge: { kind: string }) => edge.kind).sort()).toEqual(["depends_on", "overlap"]);
  });

  it("should keep the scheduling agent unable to edit the repository it reads", () => {
    const tools = String(metadata(path.join(root, "agents", "ticket-scheduler.md")).tools).split(/,\s*/);
    expect(tools).toEqual(expect.arrayContaining(["Read", "Write", "Bash"]));
    expect(tools).not.toContain("Edit");
  });

  it("should leave staged evidence inert until the caller publishes the final filename", () => {
    // Temporary JSON is not a document; phase mapping is only applied to archived documents.
    expect(isRunDocument("design-evidence.json.tmp")).toBe(false);
    expect(isRunDocument("design-evidence.json")).toBe(true);
    expect(phaseForArtifact("design-evidence.json")).toBe(6);
  });
});
