import { afterAll, describe, expect, it } from "@jest/globals";
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readConfinedFile, readBoundedFile } from "../../server/file-safety";
import { atomicWrite, diskStorage } from "../../server/evidence-archive";

const temporary = mkdtemp(path.join(os.tmpdir(), "impl-file-safety-"));
afterAll(async () => rm(await temporary, { recursive: true, force: true }));
describe("archived file confinement", () => {
  it("should refuse external sources linked by a report, including a linked parent", async () => {
    const root = await temporary;
    const tasks = path.join(root, "tasks"); await mkdir(tasks);
    await writeFile(path.join(root, "secret.txt"), "SYNTHETIC_SECRET");
    await symlink(path.join(root, "secret.txt"), path.join(tasks, "capture.png"));
    await symlink(root, path.join(tasks, "assets"));
    expect(await readConfinedFile(tasks, "capture.png")).toBeUndefined();
    expect(await readConfinedFile(tasks, "assets/secret.txt")).toBeUndefined();
    expect(await diskStorage(() => tasks, path.join(root, "archive")).readSource("capture.png")).toBeUndefined();
    await writeFile(path.join(tasks, "report.md"), "valid");
    expect((await readConfinedFile(tasks, "report.md"))?.toString()).toBe("valid");
  });
  it("should refuse oversized files before previewing them", async () => {
    const file = path.join(await temporary, "large.txt"); await writeFile(file, "x".repeat(101));
    await expect(readBoundedFile(file, 100)).rejects.toThrow("limit");
    expect((await readBoundedFile(file, 101)).length).toBe(101);
  });
  it("should prevent a destination parent from redirecting writes", async () => {
    const root = await temporary; await mkdir(path.join(root, "outside"));
    await symlink(path.join(root, "outside"), path.join(root, "redirect"));
    await expect(atomicWrite(path.join(root, "redirect/secret.txt"), "leak")).rejects.toThrow("symbolic link");
    await expect(readFile(path.join(root, "outside/secret.txt"))).rejects.toThrow();
  });
});
