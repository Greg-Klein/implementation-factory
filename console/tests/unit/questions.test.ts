import { describe, expect, it } from "@jest/globals";
import { pendingAnswerLabel } from "../../lib/run-state";
import { normalizeAnswers, normalizeQuestion } from "../../server/domain";

describe("question handling", () => {
  it("should normalize a valid Claude Code question", () => {
    expect(normalizeQuestion({
      question: "  Which branch?  ",
      header: "  Git  ",
      multiSelect: false,
      options: [
        { label: "  develop  ", description: "  Integration branch.  " },
        { label: "" },
        null,
      ],
    })).toEqual({
      question: "Which branch?",
      header: "Git",
      multiSelect: false,
      options: [{ label: "develop", description: "Integration branch." }],
    });
  });

  it("should reject inputs without a question", () => {
    expect(normalizeQuestion(null)).toBeUndefined();
    expect(normalizeQuestion({ question: "   " })).toBeUndefined();
    expect(normalizeQuestion({ header: "Git" })).toBeUndefined();
  });

  it("should require and trim every answer", () => {
    const questions = [
      { question: "Branch?", header: "Git", options: [], multiSelect: false },
      { question: "Fallback?", header: "Product", options: [], multiSelect: false },
    ];
    expect(normalizeAnswers(questions, { "Branch?": "  develop ", "Fallback?": " critical " })).toEqual({ "Branch?": "develop", "Fallback?": "critical" });
    expect(normalizeAnswers(questions, { "Branch?": "develop" })).toBeUndefined();
  });

  it("should format singular and plural pending answer labels", () => {
    expect(pendingAnswerLabel(1)).toBe("Claude is waiting for an answer");
    expect(pendingAnswerLabel(2)).toBe("Claude is waiting for 2 answers");
  });
});
