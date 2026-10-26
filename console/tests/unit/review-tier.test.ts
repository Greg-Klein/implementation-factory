import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";

import { DEFAULT_SENSITIVE_PATHS } from "../../server/config";
import { pathMatches, TIER_TWO_PATTERNS } from "../../server/review-confidence";

const hook = path.resolve(process.cwd(), "..", "hooks", "review-tier.mjs");
const schema = path.resolve(process.cwd(), "..", "bin", "env-schema.mjs");

/** The hook is ESM and Jest transpiles to CommonJS, so the comparison goes through a child. */
function hookValues() {
  const script = `
    import * as tier from ${JSON.stringify(hook)};
    import { schema } from ${JSON.stringify(schema)};
    const setting = schema.find((entry) => entry.key === "IMPL_SENSITIVE_PATHS");
    const cases = [
      ["**/auth/**", "auth/login.ts"],
      ["**/auth/**", "src/author/profile.ts"],
      [".github/workflows/**", "docs/.github/workflows/ci.yml"],
      ["**/.github/workflows/**", "docs/.github/workflows/ci.yml"],
      ["**/Dockerfile*", "deploy/Dockerfile.prod"],
      ["*.sql", "db/schema.sql"],
      ["", "anything"],
    ];
    process.stdout.write(JSON.stringify({
      defaults: tier.DEFAULT_SENSITIVE_PATHS,
      tierTwo: tier.TIER_TWO_PATTERNS,
      fallback: setting.fallback,
      matches: cases.map(([pattern, file]) => tier.pathMatches(pattern, file)),
      floors: {
        auth: tier.reviewTierFloor(["src/auth/login.ts"], tier.DEFAULT_SENSITIVE_PATHS),
        docker: tier.reviewTierFloor(["deploy/Dockerfile.prod"], tier.DEFAULT_SENSITIVE_PATHS),
        migration: tier.reviewTierFloor(["db/migrations/004.sql"], tier.DEFAULT_SENSITIVE_PATHS),
        migrate: tier.reviewTierFloor(["db/migrate/001.rb"], []),
        nestedCi: tier.reviewTierFloor(["packages/web/.github/workflows/ci.yml"], []),
        gitlab: tier.reviewTierFloor([".gitlab-ci.yml"], []),
        app: tier.reviewTierFloor(["src/app.ts"], tier.DEFAULT_SENSITIVE_PATHS),
        mixed: tier.reviewTierFloor(["src/auth/login.ts", ".github/workflows/ci.yml"], tier.DEFAULT_SENSITIVE_PATHS),
        omitted: tier.reviewTierFloor(["src/auth/login.ts", "db/migrate/001.rb"], ["**/readme/**"]),
      },
      branches: ["feat/thing", "../x", "-main", "main;rm", "origin/main"].map((name) => [name, tier.plainBranch(name) ?? null]),
      rename: tier.pathsFromNameStatus("R100\\0src/auth/token.ts\\0src/session/token.ts\\0M\\0src/app.ts\\0"),
      porcelain: tier.pathsFromPorcelain("R  src/session/token.ts\\0src/auth/token.ts\\0?? src/new.ts\\0"),
    }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  expect({ status: result.status, stderr: result.stderr }).toMatchObject({ status: 0 });
  return JSON.parse(result.stdout) as {
    defaults: string[];
    tierTwo: string[];
    fallback: string;
    matches: boolean[];
    floors: Record<string, { floor: number; sensitive: string[]; tierTwo: string[] }>;
    branches: [string, string | null][];
    rename: string[];
    porcelain: string[];
  };
}

describe("the review tier a diff cannot go below", () => {
  const values = hookValues();

  it("should use one sensitive-path list in the hook, the console and the config schema", () => {
    expect(values.defaults).toEqual([...DEFAULT_SENSITIVE_PATHS]);
    expect(values.fallback.split(",")).toEqual([...DEFAULT_SENSITIVE_PATHS]);
    expect(values.tierTwo).toEqual([...TIER_TWO_PATTERNS]);
  });

  it("should match paths the same way as the review confidence", () => {
    const cases: [string, string][] = [
      ["**/auth/**", "auth/login.ts"],
      ["**/auth/**", "src/author/profile.ts"],
      [".github/workflows/**", "docs/.github/workflows/ci.yml"],
      ["**/.github/workflows/**", "docs/.github/workflows/ci.yml"],
      ["**/Dockerfile*", "deploy/Dockerfile.prod"],
      ["*.sql", "db/schema.sql"],
      ["", "anything"],
    ];
    expect(values.matches).toEqual(cases.map(([pattern, file]) => pathMatches(pattern, file)));
  });

  it("should floor a sensitive path at tier 1 and CI or a migration at tier 2", () => {
    expect(values.floors.auth).toMatchObject({ floor: 1, tierTwo: [] });
    expect(values.floors.docker).toMatchObject({ floor: 1, tierTwo: [] });
    expect(values.floors.migration).toMatchObject({ floor: 2, tierTwo: ["db/migrations/004.sql"] });
    expect(values.floors.migrate).toMatchObject({ floor: 2, sensitive: ["db/migrate/001.rb"] });
    expect(values.floors.nestedCi).toMatchObject({ floor: 2 });
    expect(values.floors.gitlab).toMatchObject({ floor: 2 });
    expect(values.floors.app).toMatchObject({ floor: 0, sensitive: [], tierTwo: [] });
    expect(values.floors.mixed.floor).toBe(2);
  });

  it("should keep CI and migrations at tier 2 when the setting omits them, and let an auth path go", () => {
    expect(values.floors.omitted).toMatchObject({ floor: 2, sensitive: ["db/migrate/001.rb"], tierTwo: ["db/migrate/001.rb"] });
  });

  it("should accept a branch name and nothing a ref could escape with", () => {
    expect(values.branches).toEqual([
      ["feat/thing", "feat/thing"],
      ["../x", null],
      ["-main", null],
      ["main;rm", null],
      ["origin/main", "origin/main"],
    ]);
  });

  it("should keep both names of a rename", () => {
    expect(values.rename).toEqual(["src/auth/token.ts", "src/session/token.ts", "src/app.ts"]);
    expect(values.porcelain).toEqual(["src/session/token.ts", "src/auth/token.ts", "src/new.ts"]);
  });
});
