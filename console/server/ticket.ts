import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gitLabIssueEndpoint, gitLabMergeRequestEndpoint, mergeRequestStatus, type MergeRequestStatus } from "./domain.js";

const exec = promisify(execFile);

export async function fetchTicketTitle(issueUrl: string, cwd: string) {
  const endpoint = gitLabIssueEndpoint(issueUrl);
  if (!endpoint) return undefined;
  try {
    const { stdout } = await exec("glab", ["api", "--hostname", endpoint.hostname, endpoint.path], { cwd, timeout: 15_000 });
    const title = (JSON.parse(stdout) as { title?: unknown }).title;
    return typeof title === "string" && title.trim() ? title.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a merge request has been merged, asked through `glab`. Anything
 * that keeps the answer from being read, `glab` missing, the network, an
 * expired token, comes back as `unknown`, never as an error and never as open.
 */
export async function fetchMergeRequestStatus(mergeRequestUrl: string, cwd: string): Promise<MergeRequestStatus> {
  const endpoint = gitLabMergeRequestEndpoint(mergeRequestUrl);
  if (!endpoint) return "unknown";
  try {
    const { stdout } = await exec("glab", ["api", "--hostname", endpoint.hostname, endpoint.path], { cwd, timeout: 15_000 });
    return mergeRequestStatus((JSON.parse(stdout) as { state?: unknown }).state);
  } catch {
    return "unknown";
  }
}
