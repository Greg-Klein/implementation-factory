import { describe, expect, it } from "@jest/globals";
import { inlineSegments, messageBlocks } from "../../lib/conversation";
import { claudeCode } from "../../server/engine/claude-code";

/** The transcript format belongs to the agent, so the parsing is tested on its engine. */
const parseConversationLine = claudeCode.conversationLine;

const line = (entry: Record<string, unknown>) => JSON.stringify(entry);

describe("conversation extraction", () => {
  it("should keep what Claude says to the user", () => {
    expect(parseConversationLine(line({
      type: "assistant", uuid: "u1", timestamp: "2026-09-07T08:52:45.743Z", isSidechain: false,
      message: { role: "assistant", content: [{ type: "text", text: "Je commence par lire le ticket." }] },
    }))).toEqual({ id: "u1", at: "2026-09-07T08:52:45.743Z", author: "claude", text: "Je commence par lire le ticket." });
  });

  it("should keep an instruction typed by the user", () => {
    expect(parseConversationLine(line({
      type: "user", uuid: "u2", timestamp: "2026-09-07T09:00:00.000Z",
      message: { role: "user", content: "reste sur desktop" },
    }))?.author).toBe("user");
  });

  it("should keep only what was typed when the console pasted the instruction", () => {
    expect(parseConversationLine(line({
      type: "user", uuid: "u6", timestamp: "2026-09-07T09:05:00.000Z",
      message: { role: "user", content: "<pasted_content id=\"06f1\">\nles preuves vont dans la description\n</pasted_content id=\"06f1\">" },
    }))).toEqual({ id: "u6", at: "2026-09-07T09:05:00.000Z", author: "user", text: "les preuves vont dans la description" });
  });

  it("should keep an instruction queued while Claude Code was mid-turn", () => {
    expect(parseConversationLine(line({
      type: "attachment", uuid: "u5", timestamp: "2026-09-07T12:16:55.223Z", isSidechain: false,
      attachment: { type: "queued_command", prompt: "reste sur desktop", commandMode: "prompt", origin: { kind: "human" } },
    }))).toEqual({ id: "u5", at: "2026-09-07T12:16:55.223Z", author: "user", text: "reste sur desktop" });
  });

  it("should drop everything that is not the dialogue", () => {
    const technical = [
      { type: "assistant", uuid: "t1", message: { content: [{ type: "tool_use", name: "Bash", input: {} }] } },
      { type: "assistant", uuid: "t2", message: { content: [{ type: "thinking", thinking: "hmm" }] } },
      { type: "user", uuid: "t3", message: { content: [{ type: "tool_result", content: "ok" }] } },
      { type: "assistant", uuid: "t4", isSidechain: true, message: { content: [{ type: "text", text: "Rapport du sous-agent" }] } },
      { type: "user", uuid: "t5", message: { content: "<command-name>/implementation-factory:implement</command-name>" } },
      { type: "user", uuid: "t6", isMeta: true, message: { content: [{ type: "text", text: "Implement ticket: …" }] } },
      { type: "user", uuid: "t7", message: { content: "<task-notification>\n<status>completed</status>\n</task-notification>" } },
      { type: "attachment", uuid: "t8" },
      { type: "attachment", uuid: "t9", attachment: { type: "environment", snapshot: {} } },
      { type: "attachment", uuid: "t10", attachment: { type: "queued_command", prompt: "<task-notification>\n<status>completed</status>\n</task-notification>", commandMode: "prompt", origin: { kind: "human" } } },
      { type: "user", uuid: "t11", message: { content: "<agent-message from=\"aa16ec4cbd577bac1\">\n[Subagent hand-back] …\n</agent-message>" } },
    ];
    expect(technical.map((entry) => parseConversationLine(line(entry)))).toEqual(technical.map(() => undefined));
  });

  it("should ignore a truncated or malformed line", () => {
    expect(parseConversationLine('{"type":"assistant","uuid":"u3","message":{"content":[{"type":"te')).toBeUndefined();
    expect(parseConversationLine("")).toBeUndefined();
  });

  it("should strip the reminders appended to a user message", () => {
    expect(parseConversationLine(line({
      type: "user", uuid: "u4",
      message: { content: "garde le style existant<system-reminder>\nrappel interne\n</system-reminder>" },
    }))?.text).toBe("garde le style existant");
  });
});

describe("light message rendering", () => {
  it("should isolate fenced code and tables from prose", () => {
    expect(messageBlocks("Voici le plan :\n\n| Étape | Statut |\n| --- | --- |\n| 1 | fait |\n\nEnsuite je pousse.")).toEqual([
      { kind: "text", content: "Voici le plan :" },
      { kind: "code", content: "| Étape | Statut |\n| --- | --- |\n| 1 | fait |" },
      { kind: "text", content: "Ensuite je pousse." },
    ]);
    expect(messageBlocks("Résultat :\n```bash\nnpm test\n```\nc'est vert.")).toEqual([
      { kind: "text", content: "Résultat :" },
      { kind: "code", content: "npm test" },
      { kind: "text", content: "c'est vert." },
    ]);
  });

  it("should turn a heading into a bold line", () => {
    expect(messageBlocks("## État du run\nla suite")).toEqual([{ kind: "text", content: "**État du run**\nla suite" }]);
  });

  it("should split bold and inline code out of a paragraph", () => {
    expect(inlineSegments("le fichier `page.tsx` est **prêt**")).toEqual([
      { kind: "plain", value: "le fichier " },
      { kind: "code", value: "page.tsx" },
      { kind: "plain", value: " est " },
      { kind: "strong", value: "prêt" },
    ]);
    expect(inlineSegments("rien à formater")).toEqual([{ kind: "plain", value: "rien à formater" }]);
  });

  it("should turn the URLs of a message into links", () => {
    expect(inlineSegments("MR ouverte : https://gitlab.com/group/repo/-/merge_requests/266.")).toEqual([
      { kind: "plain", value: "MR ouverte : " },
      { kind: "link", value: "https://gitlab.com/group/repo/-/merge_requests/266", href: "https://gitlab.com/group/repo/-/merge_requests/266" },
      { kind: "plain", value: "." },
    ]);
    expect(inlineSegments("voir [le ticket 258](https://gitlab.com/group/repo/-/work_items/258)")).toEqual([
      { kind: "plain", value: "voir " },
      { kind: "link", value: "le ticket 258", href: "https://gitlab.com/group/repo/-/work_items/258" },
    ]);
    expect(inlineSegments("pas de lien ici : gitlab.com/group")).toEqual([{ kind: "plain", value: "pas de lien ici : gitlab.com/group" }]);
  });
});
