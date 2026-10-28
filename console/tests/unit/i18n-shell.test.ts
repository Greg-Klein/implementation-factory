import { describe, expect, it } from "@jest/globals";
import { texts } from "../../lib/i18n/texts";

describe("the shell, rail and launch texts", () => {
  it("should keep the English batch notice as it was", () => {
    expect(texts("en").shell.batchDetail(3, 2)).toBe("3 tickets added. The queue shows which start and which wait. 2 already queued, running or waiting for merge were skipped.");
  });

  it("should agree the French batch notice with its counts", () => {
    expect(texts("fr").shell.batchDetail(1, 1)).toBe("1 ticket ajouté. La file montre lesquels démarrent et lesquels attendent. 1 déjà en file, en cours ou en attente de merge a été ignoré.");
    expect(texts("fr").shell.batchDetail(2, 0)).toBe("2 tickets ajoutés. La file montre lesquels démarrent et lesquels attendent.");
  });

  it("should write the French queue and watcher labels", () => {
    expect(texts("fr").rail.batchTickets(2)).toBe("2 tickets en file");
    expect(texts("fr").rail.stackExplain("#12", "merge request")).toContain("Elle ne peut être mergée qu'après celle de #12.");
    expect(texts("fr").rail.notStarted("aucun checkout")).toBe("Non démarré : aucun checkout");
  });

  it("should write the French launch form with its plurals", () => {
    expect(texts("fr").launch.ticketsRecognized(2)).toBe("2 tickets reconnus");
    expect(texts("fr").launch.duplicatesSkipped(1)).toBe("1 doublon ignoré");
    expect(texts("fr").launch.noCheckoutFound(2)).toContain("ces tickets");
    expect(texts("en").launch.fixCounts("lint", 3, "CLAUDE.md", undefined)).toBe("lint · 3 runs · CLAUDE.md");
  });
});
