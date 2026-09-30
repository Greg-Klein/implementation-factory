import { describe, expect, it } from "@jest/globals";
import { detailParagraphs, hasMoreDetail, markCode, taskAbstract } from "../../lib/plan-task";

describe("task abstract shown in the tracking detail", () => {
  it("should lead with the planner's summary when there is one", () => {
    expect(taskAbstract({ summary: "Ajoute le panneau.", description: "Long détail." })).toBe("Ajoute le panneau.");
  });

  it("should fall back to the first sentence, without cutting on a file extension", () => {
    const description = "Tout se joue dans src/hooks/useChat.ts ; le store ne change pas. Imports : " + "x ".repeat(200);
    expect(taskAbstract({ description })).toBe("Tout se joue dans src/hooks/useChat.ts ; le store ne change pas.");
  });

  it("should cut a first sentence that is too long on a word, with an ellipsis", () => {
    const abstract = taskAbstract({ description: `${"mot ".repeat(100)}fin.` });
    expect(abstract?.endsWith("mot…")).toBe(true);
    expect(abstract!.length).toBeLessThanOrEqual(241);
  });

  it("should offer the full description only when it says more than the abstract", () => {
    expect(hasMoreDetail({ description: "Une phrase courte." })).toBe(false);
    expect(hasMoreDetail({ summary: "Résumé.", description: "Une phrase courte." })).toBe(true);
    expect(hasMoreDetail({ summary: "Résumé." })).toBe(false);
  });
});

describe("developer detail of a task", () => {
  it("should keep the paragraphs the planner wrote", () => {
    expect(detailParagraphs("Premier point.\n\nSecond   point.")).toEqual(["Premier point.", "Second point."]);
  });

  it("should split a long single block on its sentences", () => {
    const first = `Modifier src/hooks/useChat.ts ${"sans rien casser ".repeat(10)}ici.`;
    const second = `Puis ajouter les tests ${"de bout en bout ".repeat(8)}ensuite`;
    expect(detailParagraphs(`${first} ${second}`)).toEqual([first, second]);
  });
});

describe("code marking in plan text", () => {
  it("should quote paths, identifiers, file names and calls", () => {
    expect(markCode("Voir src/hooks/useChat.ts et ../helpers/pdfStore, puis sendMessage() dans MessageInput, README.md et storyFixtures.tsx."))
      .toBe("Voir `src/hooks/useChat.ts` et `../helpers/pdfStore`, puis `sendMessage()` dans `MessageInput`, `README.md` et `storyFixtures.tsx`.");
  });

  it("should leave French prose, quoted code and links alone", () => {
    expect(markCode("Le panneau et/ou la Liste restent. `déjà cité` https://example.com/a/b.md")).toBe("Le panneau et/ou la Liste restent. `déjà cité` https://example.com/a/b.md");
  });
});
