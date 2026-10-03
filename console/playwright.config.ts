import { defineConfig } from "@playwright/test";
import path from "node:path";
import { checkoutsRoot, createSampleCheckout, dataDirectory, fakeClaudeDirectory, fakeClaudeInputDirectory, hookToken, prepareDataDirectory, untrustedRoot } from "./tests/fixtures";

const port = 3211;

createSampleCheckout();
// The config is read again in every worker, after the console booted: only the main process prepares its data.
if (process.env.TEST_WORKER_INDEX === undefined) prepareDataDirectory();

export default defineConfig({
  testDir: "./tests/integration",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    env: {
      PORT: String(port),
      IMPL_DEMO_STEP_MS: "500",
      IMPL_SEARCH_ROOTS: checkoutsRoot,
      // Isolate the suite from whatever .env the developer keeps locally.
      IMPL_ENV_FILE: path.join(checkoutsRoot, "absent.env"),
      // The self-audit is on by default, and a run finishing under test must not
      // start a real improvement session on this checkout.
      IMPL_SELF_IMPROVEMENT_AUTORUN: "false",
      IMPL_HOOK_TOKEN: hookToken,
      // Runs the suite starts for real land here, not in the developer's own history.
      IMPL_DATA_DIR: dataDirectory,
      // Short health graces, so an incident shows within seconds rather than a minute.
      IMPL_HEALTH_TICK_MS: "400",
      IMPL_HEALTH_TURN_GRACE_MS: "1500",
      IMPL_HEALTH_ARTIFACT_GRACE_MS: "1000",
      FAKE_CLAUDE_INPUT_DIR: fakeClaudeInputDirectory,
      // Runs started under this directory open on the folder trust dialog.
      FAKE_CLAUDE_UNTRUSTED_ROOT: untrustedRoot,
      // A launched run gets a stand-in session instead of a real Claude Code.
      PATH: `${fakeClaudeDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
    },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
