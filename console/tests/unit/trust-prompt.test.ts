import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTrustPromptWatcher, matchesTrustDialog, trustAnswerKeys, visibleText } from "../../server/engine/trust-prompt";

/** What Claude Code 2.1.288 wrote to its terminal in a directory it had never seen, one entry per write. */
const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "trust-dialog.json"), "utf8")) as { claudeCodeVersion: string; chunks: string[] };
const dialog = fixture.chunks.join("");

/** Feeds every chunk and returns what the watcher said, in order. */
function changes(chunks: string[], watcher = createTrustPromptWatcher()) {
  return chunks.flatMap((chunk) => { const change = watcher.feed(chunk); return change ? [change] : []; });
}

describe("reading the terminal as text", () => {
  it("should drop escape sequences, cursor moves and blanks", () => {
    expect(visibleText("\u001b[2G\u001b[1mAccessing\u001b[12Gworkspace:\u001b[22m\r\r\n")).toBe("accessingworkspace:");
    expect(visibleText("\u001b]0;title\u0007No,\u001b[8Gexit\u001b(B\u000f")).toBe("no,exit");
  });

  it("should hold back an escape sequence the write was cut in", () => {
    expect(visibleText("files\u001b[")).toBe("files");
    expect(visibleText("files\u001b[58")).toBe("files");
    expect(visibleText("files\u001b")).toBe("files");
  });
});

describe("recognising the folder trust dialog", () => {
  it("should keep the sample free of anything but the dialog", () => {
    expect(fixture.claudeCodeVersion).toBe("2.1.288");
    expect(dialog).not.toMatch(/Users|var\/folders/);
    expect(visibleText(dialog)).toContain("/private/tmp/trust-fixture");
  });

  it("should recognise the captured dialog as a whole", () => {
    expect(matchesTrustDialog(dialog)).toBe(true);
  });

  it("should recognise it in the writes it arrived in, once", () => {
    expect(changes(fixture.chunks)).toEqual(["shown"]);
  });

  it("should recognise it whichever byte the output is cut at", () => {
    for (let cut = 1; cut < dialog.length; cut += 1) {
      expect(changes([dialog.slice(0, cut), dialog.slice(cut)])).toEqual(["shown"]);
    }
  });

  it("should recognise it one byte at a time", () => {
    expect(changes([...dialog])).toEqual(["shown"]);
  });

  it("should recognise it through extra colours, cursor moves and a title sequence", () => {
    const noisy = `\u001b]0;claude\u0007\u001b[?25l${dialog.replace(/ |\u001b\[(\d+)G/g, (match) => `\u001b[0m${match}\u001b[38;5;12m\u001b[1C\u001b[1D`)}`;
    expect(changes([noisy])).toEqual(["shown"]);
  });

  it("should recognise it drawn with plain spaces and at another width", () => {
    const plain = "Accessing workspace:\r\n\r\n /tmp/repo\r\n\r\n Quick safety check: Is this a project you created or one you\r\n trust?\r\n\r\n ❯ No, exit\r\n   Yes, I trust this folder\r\n\r\n Enter to confirm · Esc to cancel\r\n";
    expect(changes([plain])).toEqual(["shown"]);
  });

  it.each([
    ["an empty screen", ""],
    ["the welcome screen", "Claude Code v2.1.288\r\nOpus · ~/workspace/trust-probe\r\n❯ Try \"refactor app.ts\"\r\n⏵⏵ auto mode on"],
    ["a message about trust", "I do not trust this folder layout. No, exit code 1 is not expected here."],
    ["the heading alone", "Accessing workspace:\r\n /tmp/repo\r\n"],
    ["the options without the heading", "❯ No, exit\r\n  Yes, I trust this folder\r\nEnter to confirm · Esc to cancel"],
    ["the phrases out of order", "Yes, I trust this folder\r\nNo, exit\r\nAccessing workspace:"],
    ["an older wording", "Do you trust the files in this folder?\r\n /tmp/repo\r\n❯ 1. Yes, proceed\r\n  2. No, exit\r\n"],
    ["a reworded dialog", "Accessing workspace:\r\n /tmp/repo\r\n❯ No, quit\r\n  Yes, trust it\r\n"],
  ])("should stay silent on %s", (_name, output) => {
    expect(matchesTrustDialog(output)).toBe(false);
    expect(changes([output])).toEqual([]);
  });

  it("should stop looking once the session has drawn its own screen", () => {
    const watcher = createTrustPromptWatcher();
    expect(changes(Array.from({ length: 20 }, () => "x".repeat(1_000)), watcher)).toEqual([]);
    // The same text printed later, by a tool or a file being read, is not the dialog.
    expect(changes(fixture.chunks, watcher)).toEqual([]);
    expect(watcher.shown).toBe(false);
  });
});

describe("following the dialog until it leaves", () => {
  const shownWatcher = () => { const watcher = createTrustPromptWatcher(); changes(fixture.chunks, watcher); return watcher; };

  it("should not flap when the dialog is drawn again", () => {
    const watcher = shownWatcher();
    expect(changes(fixture.chunks, watcher)).toEqual([]);
    expect(changes(["\u001b[2K\u001b[4GNo,\u001b[8Gexit\r\r\n\u001b[2K\u001b[2G❯\u001b[4GYes,\u001b[9GI\u001b[11Gtrust\u001b[17Gthis\u001b[22Gfolder"], watcher)).toEqual([]);
    expect(watcher.shown).toBe(true);
  });

  it("should not take terminal housekeeping for the dialog leaving", () => {
    const watcher = shownWatcher();
    expect(changes(["\u001b[?1006l\u001b[?1003l", "\u001b[1D\u001b[4B", "\u001b[?25h"], watcher)).toEqual([]);
    expect(watcher.shown).toBe(true);
  });

  it("should say the dialog left once the session draws something else", () => {
    const watcher = shownWatcher();
    const welcome = `\u001b[2J\u001b[H${"─".repeat(120)}\r\n Claude Code v2.1.288\r\n ~/workspace/repo\r\n${"─".repeat(120)}\r\n ❯ \r\n${"─".repeat(120)}\r\n ⏵⏵ auto mode on (shift+tab to cycle)\r\n${"·".repeat(80)}`;
    expect(changes([welcome.slice(0, 200), welcome.slice(200)], watcher)).toEqual(["gone"]);
    expect(watcher.shown).toBe(false);
  });

  it("should look afresh after an answer, the dialog still on screen included", () => {
    const watcher = shownWatcher();
    watcher.answered();
    expect(watcher.shown).toBe(false);
    expect(changes(fixture.chunks, watcher)).toEqual(["shown"]);
  });

  it("should follow the option the cursor is on", () => {
    const watcher = shownWatcher();
    expect(watcher.selected).toBe("no");
    watcher.feed("\u001b[2K\u001b[4GNo,\u001b[8Gexit\r\r\n\u001b[2K\u001b[2G❯\u001b[4GYes,\u001b[9GI\u001b[11Gtrust\u001b[17Gthis\u001b[22Gfolder");
    expect(watcher.selected).toBe("yes");
    watcher.feed("\u001b[2K\u001b[2G❯\u001b[4GNo,\u001b[8Gexit\r\r\n\u001b[2K\u001b[4GYes,\u001b[9GI\u001b[11Gtrust\u001b[17Gthis\u001b[22Gfolder");
    expect(watcher.selected).toBe("no");
  });
});

describe("answering the dialog", () => {
  it("should refuse with the Escape the dialog offers, wherever the cursor is", () => {
    expect(trustAnswerKeys("refuse", "no")).toEqual(["\u001b"]);
    expect(trustAnswerKeys("refuse", "yes")).toEqual(["\u001b"]);
  });

  it("should accept by confirming Yes, moving to it first from the default No", () => {
    expect(trustAnswerKeys("accept", "no")).toEqual(["\u001b[B", "\r"]);
    expect(trustAnswerKeys("accept", "yes")).toEqual(["\r"]);
  });
});
