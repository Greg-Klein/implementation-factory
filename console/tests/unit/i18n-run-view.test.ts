import { describe, expect, it } from "@jest/globals";
import { texts } from "../../lib/i18n/texts";

describe("the run view texts", () => {
  it("should name the evidence tab Preuves in French and keep English unchanged", () => {
    expect(texts("fr").run.tabEvidence).toBe("Preuves");
    expect(texts("en").run.tabEvidence).toBe("Evidence");
  });

  it("should agree the plural of tasks and observations in French", () => {
    expect(texts("fr").run.taskCount(1)).toBe("1 tâche");
    expect(texts("fr").run.taskCount(3)).toBe("3 tâches");
    expect(texts("fr").run.diagnosis(2)).toBe("Diagnostic · 2 observations");
    expect(texts("en").run.diagnosis(1)).toBe("Diagnosis · 1 observation");
  });

  it("should capitalise the unread reason in the tab tooltip in both languages", () => {
    expect(texts("fr").run.unreadTitle("nouveau message")).toBe("Nouveau message depuis votre dernière visite sur cet onglet");
    expect(texts("en").run.unreadTitle("new message")).toBe("New message since your last visit to this tab");
  });

  it("should write the token line of the rail the way it did in English", () => {
    expect(texts("en").run.tokensPilot("12k", 40, 2)).toBe("Pilot 12k in 40 calls, 2 agents");
    expect(texts("fr").run.tokensPilot("12k", 40, 0)).toBe("Pilote 12k en 40 appels");
  });

  it("should translate the conversation prompts", () => {
    expect(texts("fr").conversation.thinking).toBe("Claude réfléchit…");
    expect(texts("fr").conversation.documentCount(2)).toBe("2 fichiers");
    expect(texts("en").conversation.documentCount(1)).toBe("1 file");
  });
});
