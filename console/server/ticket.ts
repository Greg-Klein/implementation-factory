import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { deliveryEndpoint, deliveryStatus, issueEndpoint, type ForgeEndpoint, type MergeRequestStatus } from "./domain.js";

const exec = promisify(execFile);

/** The CLI each forge is asked through. Both take `api --hostname <host> <path>` and answer in JSON. */
const FORGE_CLI = { gitlab: "glab", github: "gh" } as const;

/**
 * The environment the CLI runs in, named explicitly. Left out, a child process
 * takes the environment of the Node process itself, which a test runner keeps
 * apart from the one the tests set: the unit suite then reached the real
 * `glab`, and gitlab.com, with invented tickets.
 */
const cliOptions = (cwd: string) => ({ cwd, timeout: 15_000, env: process.env });

async function askForge(endpoint: ForgeEndpoint, cwd: string) {
  const { stdout } = await exec(FORGE_CLI[endpoint.forge], ["api", "--hostname", endpoint.hostname, endpoint.path], cliOptions(cwd));
  return JSON.parse(stdout) as Record<string, unknown>;
}

export async function fetchTicketTitle(issueUrl: string, cwd: string) {
  const endpoint = issueEndpoint(issueUrl);
  if (!endpoint) return undefined;
  try {
    const title = (await askForge(endpoint, cwd)).title;
    return typeof title === "string" && title.trim() ? title.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a merge request or a pull request has been merged, asked through
 * the CLI of its forge. Anything that keeps the answer from being read, the
 * CLI missing, the network, an expired token, comes back as `unknown`, never
 * as an error and never as open.
 */
export async function fetchMergeRequestStatus(mergeRequestUrl: string, cwd: string): Promise<MergeRequestStatus> {
  const endpoint = deliveryEndpoint(mergeRequestUrl);
  if (!endpoint) return "unknown";
  try {
    return deliveryStatus(endpoint.forge, await askForge(endpoint, cwd));
  } catch {
    return "unknown";
  }
}
