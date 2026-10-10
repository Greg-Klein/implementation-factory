import { defineConfig } from "@playwright/test";
import path from "node:path";
import { controlToken, checkoutsRoot, createSampleCheckout, dataDirectory, fakeClaudeDirectory, fakeClaudeInputDirectory, fakeGhDirectory, fakeGlabDirectory, hookToken, prepareDataDirectory, scheduleFixtureFile, untrustedRoot } from "./tests/fixtures";

const port = 3211;

createSampleCheckout();
// The config is read again in every worker, after the console booted: only the main process prepares its data.
if (process.env.TEST_WORKER_INDEX === undefined) prepareDataDirectory();

export default defineConfig({
  testDir: "./tests/integration",
  globalSetup: "./tests/auth.setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    storageState: path.join(dataDirectory, "browser-auth.json"),
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  // What only a start of the console can show runs first, before any test hands the console back empty.
  projects: [
    { name: "boot", testMatch: /boot\.setup\.ts$/ },
    { name: "console", testMatch: /\.spec\.ts$/, dependencies: ["boot"] },
  ],
  webServer: {
    command: "npm run dev",
    env: {
      PORT: String(port),
      IMPL_DEMO_STEP_MS: "500",
      IMPL_SEARCH_ROOTS: checkoutsRoot,
      // Isolate the suite from whatever .env the developer keeps locally.
      IMPL_ENV_FILE: path.join(checkoutsRoot, "absent.env"),
      // The shell wins over the defaults, and a session the console started
      // inherits its settings: the specs read the summary in English.
      IMPL_LANGUAGE: "en",
      // The self-audit is on by default, and a run finishing under test must not
      // start a real improvement session on this checkout, nor merge one of its branches.
      IMPL_SELF_IMPROVEMENT_AUTORUN: "false",
      IMPL_HOOK_TOKEN: hookToken,
      IMPL_CONTROL_TOKEN: controlToken,
      // Runs the suite starts for real land here, not in the developer's own history.
      IMPL_DATA_DIR: dataDirectory,
      // Same inheritance: a session the console started would read the developer's own proposals.
      IMPL_TICKET_PROPOSALS_FILE: path.join(dataDirectory, "ticket-proposals.json"),
      // Short health graces, so an incident shows within seconds rather than a minute.
      IMPL_HEALTH_TICK_MS: "400",
      IMPL_HEALTH_TURN_GRACE_MS: "1500",
      IMPL_HEALTH_ARTIFACT_GRACE_MS: "1000",
      FAKE_CLAUDE_INPUT_DIR: fakeClaudeInputDirectory,
      // Runs started under this directory open on the folder trust dialog.
      FAKE_CLAUDE_UNTRUSTED_ROOT: untrustedRoot,
      // What the stand-in scheduling session answers, and how long it is given before its batch runs one ticket at a time.
      FAKE_CLAUDE_SCHEDULE: scheduleFixtureFile,
      IMPL_SCHEDULE_TIMEOUT_MS: "4000",
      // The stand-in `glab` sits next to the stand-in `claude`: the suite never reaches a real GitLab.
      FAKE_GLAB_DIR: fakeGlabDirectory,
      // The same for `gh` and GitHub.
      FAKE_GH_DIR: fakeGhDirectory,
      IMPL_MERGE_POLL_MS: "500",
      // The file a ticket watcher would write is read often enough for a test to see it change.
      IMPL_PROPOSALS_POLL_MS: "300",
      // A launched run gets a stand-in session instead of a real Claude Code, and `glab` a stand-in too.
      PATH: `${fakeClaudeDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
    },
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
