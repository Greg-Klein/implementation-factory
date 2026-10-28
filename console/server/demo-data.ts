import type { SessionUsage } from "./engine/index.js";
import type { RunState } from "./types.js";
import type { Language } from "../lib/i18n/index.js";
export const demoSelfImprovementDiff = `diff --git a/agents/developer/prompts/system.md b/agents/developer/prompts/system.md
index 3a2f1c8..b7e04d2 100644
--- a/agents/developer/prompts/system.md
+++ b/agents/developer/prompts/system.md
@@ -14,6 +14,9 @@ You are the developer agent of the implementation-factory workflow.
 ## Rules

 - Strictly follow the ticket's acceptance criteria.
+- Before marking the implementation as done, check that each
+  acceptance criterion has a matching unit or integration test.
+- If a criterion is not covered, write the test before moving on to the review.
 - Do not modify files outside the scope defined in the plan.
 - Report any blocker or ambiguity to the orchestrator immediately.

diff --git a/agents/senior-reviewer/prompts/system.md b/agents/senior-reviewer/prompts/system.md
index 9f8c3e1..c14a07f 100644
--- a/agents/senior-reviewer/prompts/system.md
+++ b/agents/senior-reviewer/prompts/system.md
@@ -22,7 +22,12 @@ You are the senior reviewer of the implementation-factory workflow.
 ## Validation criteria

 - Each acceptance criterion of the ticket is covered by a test.
+- Edge cases (timezone, locale, permissions) are explicitly tested.
 - The code shows no visible regression in the existing tests.
 - Accessibility is respected for every UI component.
+
+## On time zones
+
+Always check that displayed dates and times take the user's time zone
+into account. It is a frequent source of regressions
+identified in previous runs.
`;

/**
 * What the simulated workflow writes for acceptance coverage: five criteria
 * that end in every state the "Evidence" tab knows (verified, failed, blocked,
 * unverified), and a second review round that replaces a failure of the first
 * while keeping it, and its capture, in the history.
 */
export const DEMO_SNAPSHOTS = { implementation: "snap-demo-5c1e0a7d9f2b", final: "snap-demo-9b04f3e2a61c" } as const;

const CAPTURES = {
  roundOne: "iVBORw0KGgoAAAANSUhEUgAAAPAAAACWCAIAAABvmpKCAAABq0lEQVR42u3cQQqAIBBA0Q4iRDcM2nS1ThVYEBREexe1E9MH7wT6VzNit+0rVKNzBAgaBA2CBkEjaBA0CBoEDYJG0CBoEDQIGgSNoF+c1wHZCBpBCxpBg6BB0Aha0Aha0AgaBA2CRtCCRtCCRtBQb9Bh6OGToBG0oBG0oBG0oBE0ghY0ghY0ghY0ghY0tQUN3nKAoBG0oBG0oBE0CBoEjaAFjaAFjaBB0FBO0OM8kY2gBS1oQQta0IJG0IJG0IIWtKCN7RC0oBE0CBoEjaAFjaBB0GCxQttLGUEjaEELWtCCFrSgEbSgEbSxHcZ2gkbQIGgQNIIWNIIWNIIGQYOgEbSgEbSgETQIGgSNoAWNoAWNoKGmoJcQEneMkBA0ghY0ghY0ghY0gkbQgkbQgkbQgkbQgkbQCFrQCFrQCFrQCFrQCBpBCxpBCxpBCxpBCxpBI2hBI2hBI2hBI2iXh6ARtKARtKARNPh9FASNoAWNoAWNoEHQIGgELWgELWgEDYIGQSNoQSNoQSNo+FvQUDJBI2gQNAgaBI2gQdAgaBA0CBpBg6BB0CBoEDRNeQBcUPVx86/LeAAAAABJRU5ErkJggg==",
  reference: "iVBORw0KGgoAAAANSUhEUgAAAPAAAACWCAIAAABvmpKCAAABhUlEQVR42u3bsQkAIAxFQee0dghXFizcQFsHMCB6jz9BuDZpSg+VnEBAS0BLQEtAC2gJaAloCWgJaAEtAS0BLQEtAS2gJaAloCWgpRDQuRaz4wPagAbagAbagDYD2oAG2oAG2oAG2oA2A9qABtqABtqABtqANgPagAbagAbagDYD2uw+0JKvbwloCWgBLQEtAS0BLQEtoCWgJaAloCWgBbQEtAS0BLQEtICW/gDdRzM7PqANaKANaKANaDOgDWigDWigDWigDWgzoA1ooA1ooA1ooA1oM6ANaKANaKANaDOgzYA2oIE2oIE2oM2ANgPagAbagAbagDYD2gxoAxpoAxpoA9oMaDOgDWigDWigDWgzoA1ooA1ooA1ooA1oM6ANaKANaKANaKANaDOgDWigDWigDWjXN6DNgDaggTaggTagzYA2A9qAjgMt3RbQAloCWgJaAlpAS0BLQEtAS0ALaAloCWgJaAloAS0BLQEtAS0BLaAloCWgJaAloAW0BLQEtAS0tLUAbBdKI9fqZY4AAAAASUVORK5CYII=",
  roundTwo: "iVBORw0KGgoAAAANSUhEUgAAAPAAAACWCAIAAABvmpKCAAABrklEQVR42u3csQmAMBBAUVt3EMSZXESwcTC3srBQEEyhfQrtRM8Hb4LkV3chxbLOEEbhCBA0CBoEDYJG0CBoEDQIGgSNoEHQIGgQNAgaQV/Y0waPETSCFjSCBkGDoBG0oBG0oBE0CBoEjaAFjaAFjaAhbtBVU8MtQSNoQSNoQSNoQSNoBC1oBC1oBC1oBC1oogUN3nKAoBG0oBG0oBE0CBoEjaAFjaAFjaBB0PCeoLuh5zGCFrSgBS1oQQsaQQsaQQta0II2tkPQgkbQIGgQNIIWNIIGQYPFCv9eyggaQQta0IIWtKAFjaAFjaCN7TC2EzSCBkGDoBG0oBG0oBE0CBoEjaAFjaAFjaBB0CBoBC1oBC1oBA2Rgh7bMnOkCTKCRtCCRtCCRtCCRtAIWtAIWtAIWtAIWtAIGkELGkELGkELGkELGkEjaEEjaEEjaEEjaEEjaAQtaAQtaAQtaATt8hA0ghY0ghY0gga/j4KgEbSgEbSgETQIGgSNoAWNoAWNoEHQIGgELWgELWgEDV8LGt5M0AgaBA2CBkEjaBA0CBoEDYJG0CBoEDQIGgTNr5zw8ERAS6cq7QAAAABJRU5ErkJggg==",
};

const PANEL_CAPTURE = "iVBORw0KGgoAAAANSUhEUgAAAPAAAACWCAIAAABvmpKCAAABhUlEQVR42u3bsQkAIAxFQee0dghXFizcQFsHMCB6jz9BuDZpSg+VnEBAS0BLQEtAC2gJaAloCWgJaAEtAS0BLQEtAS2gJaAloCWgpRDQuRaz4wPagAbagAbagDYD2oAG2oAG2oAG2oA2A9qABtqABtqABtqANgPagAbagAbagDYD2uw+0JKvbwloCWgBLQEtAS0BLQEtoCWgJaAloCWgBbQEtAS0BLQEtICW/gDdRzM7PqANaKANaKANaDOgDWigDWigDWigDWgzoA1ooA1ooA1ooA1oM6ANaKANaKANaDOgzYA2oIE2oIE2oM2ANgPagAbagAbagDYD2gxoAxpoAxpoA9oMaDOgDWigDWigDWgzoA1ooA1ooA1ooA1oM6ANaKANaKANaKANaDOgDWigDWigDWjXN6DNgDaggTaggTagzYA2A9qAjgMt3RbQAloCWgJaAlpAS0BLQEtAS0ALaAloCWgJaAloAS0BLQEtAS0BLaAloCWgJaAloAW0BLQEtAS0tLUAbBdKI9fqZY4AAAAASUVORK5CYII=";

/**
 * Everything the simulated reviewers write in a free-text field follows the
 * language of the run, as the workflow's own documents do. Identifiers,
 * verdicts, methods and commands never change.
 */
export function demoAcceptanceOf(language: Language) {
  const l = (en: string, fr: string) => language === "fr" ? fr : en;
  return {
  criteria: {
  "schemaVersion": 1,
  "revision": 1,
  "criteria": [
    {
      "id": "AC1",
      "text": l("Preferences are saved per user.", "Les préférences sont enregistrées par utilisateur."),
      "revision": 1,
      "source": {
        "kind": "ticket",
        "reference": "ticket-simule://IH-42",
        "excerpt": l("Preferences are saved per user.", "Les préférences sont enregistrées par utilisateur.")
      },
      "verification": {
        "expected": l("A second account does not see the first one's settings.", "Un second compte ne voit pas les réglages du premier.")
      }
    },
    {
      "id": "AC2",
      "text": l("Critical alerts stay displayed when notifications are turned off, whatever the time zone.", "Les alertes critiques restent affichées quand les notifications sont désactivées, quel que soit le fuseau horaire."),
      "revision": 1,
      "source": {
        "kind": "user_answer",
        "excerpt": l("Keep critical alerts", "Garder les alertes critiques")
      },
      "verification": {
        "expected": l("Critical alert visible at 11 pm in UTC+2.", "Alerte critique visible à 23 h en UTC+2."),
        "requiredChecks": [
          {
            "id": "AC2-C1",
            "description": l("Alert visible with notifications turned off", "Alerte visible avec les notifications désactivées"),
            "method": "browser"
          },
          {
            "id": "AC2-C2",
            "description": l("Alert visible near midnight in another time zone", "Alerte visible près de minuit dans un autre fuseau horaire"),
            "method": "test"
          }
        ]
      }
    },
    {
      "id": "AC3",
      "text": l("The setting takes effect without reloading the page.", "Le réglage prend effet sans recharger la page."),
      "revision": 1,
      "source": {
        "kind": "ticket",
        "excerpt": l("The setting takes effect without reloading the page.", "Le réglage prend effet sans recharger la page.")
      }
    },
    {
      "id": "AC4",
      "text": l("A double click on Save sends only one request.", "Un double clic sur Enregistrer n'envoie qu'une seule requête."),
      "revision": 1,
      "source": {
        "kind": "ticket",
        "excerpt": l("Avoid double saves.", "Éviter les doubles enregistrements.")
      }
    },
    {
      "id": "AC5",
      "text": l("Preferences are picked up by the mobile app.", "Les préférences sont reprises par l'application mobile."),
      "revision": 1,
      "source": {
        "kind": "prd",
        "excerpt": l("Settings shared between web and mobile.", "Réglages partagés entre le web et le mobile.")
      }
    }
  ]
},
  plan: {
  "criteria_revision": 1,
  "summary": l("Per-user notification preferences, critical alerts kept.", "Préférences de notification par utilisateur, alertes critiques conservées."),
  "acceptance_criteria": [
    l("AC1: Preferences are saved per user.", "AC1 : Les préférences sont enregistrées par utilisateur."),
    l("AC2: Critical alerts stay displayed when notifications are turned off, whatever the time zone.", "AC2 : Les alertes critiques restent affichées quand les notifications sont désactivées, quel que soit le fuseau horaire."),
    l("AC3: The setting takes effect without reloading the page.", "AC3 : Le réglage prend effet sans recharger la page."),
    l("AC4: A double click on Save sends only one request.", "AC4 : Un double clic sur Enregistrer n'envoie qu'une seule requête."),
    l("AC5: Preferences are picked up by the mobile app.", "AC5 : Les préférences sont reprises par l'application mobile.")
  ],
  "tasks": [
    {
      "id": "T1",
      "title": l("Add the preferences model", "Ajouter le modèle de préférences"),
      "summary": l("Saves each account's notification preferences, with default values for existing accounts.", "Enregistre les préférences de notification de chaque compte, avec des valeurs par défaut pour les comptes existants."),
      "description": l("Add a notification preferences object (channel, quiet hours) to the profile, persisted on the API side, with default values for existing accounts.", "Ajouter au profil un objet de préférences de notification (canal, plage silencieuse), persisté côté API, avec des valeurs par défaut pour les comptes existants."),
      "file_paths": [
        "src/models/notification-preferences.ts",
        "src/api/preferences.ts"
      ],
      "complexity": "S",
      "criterion_ids": [
        "AC1",
        "AC5"
      ],
      "dependencies": []
    },
    {
      "id": "T2",
      "title": l("Create the settings panel", "Créer le panneau de réglages"),
      "summary": l("Adds a Notifications panel to the settings where critical alerts always stay on.", "Ajoute aux réglages un panneau Notifications où les alertes critiques restent toujours actives."),
      "description": l("Create `NotificationsPanel` in `src/settings/`: one toggle per channel and a quiet range, read and written by `usePreferences()`.\n\nCritical alerts have no toggle: the panel says they stay on. The Save button is disabled while the request is being sent.", "Créer `NotificationsPanel` dans `src/settings/` : un interrupteur par canal et une plage silencieuse, lus et écrits par `usePreferences()`.\n\nLes alertes critiques n'ont pas d'interrupteur : le panneau indique qu'elles restent actives. Le bouton Enregistrer est désactivé pendant l'envoi de la requête."),
      "file_paths": [
        "src/settings/NotificationsPanel.tsx",
        "src/settings/NotificationsPanel.module.css"
      ],
      "complexity": "M",
      "criterion_ids": [
        "AC2",
        "AC4"
      ],
      "dependencies": [
        "T1"
      ]
    },
    {
      "id": "T3",
      "title": l("Wire up optimistic saving", "Brancher l'enregistrement optimiste"),
      "summary": l("Saves each setting as soon as it changes, with no reload and no double send.", "Enregistre chaque réglage dès qu'il change, sans rechargement ni double envoi."),
      "description": l("Save each change immediately with an optimistic update, rolled back if the API refuses. A second click while the request is being sent does not start another one.", "Enregistrer chaque changement immédiatement avec une mise à jour optimiste, annulée si l'API refuse. Un second clic pendant l'envoi de la requête n'en lance pas une autre."),
      "file_paths": [
        "src/settings/useSavePreferences.ts"
      ],
      "complexity": "M",
      "criterion_ids": [
        "AC3",
        "AC4"
      ],
      "dependencies": [
        "T2"
      ]
    },
    {
      "id": "T4",
      "title": l("Test the critical alerts fallback", "Tester le repli des alertes critiques"),
      "summary": l("Checks that critical alerts stay visible when notifications are turned off.", "Vérifie que les alertes critiques restent visibles quand les notifications sont désactivées."),
      "description": l("Cover with tests the display of critical alerts when notifications are turned off, including around midnight in another time zone.", "Couvrir par des tests l'affichage des alertes critiques quand les notifications sont désactivées, y compris autour de minuit dans un autre fuseau horaire."),
      "file_paths": [
        "src/alerts/critical-alerts.test.ts"
      ],
      "complexity": "S",
      "criterion_ids": [
        "AC2"
      ],
      "dependencies": [
        "T2"
      ]
    }
  ]
},
  developer: {
  "schemaVersion": 2,
  "source": "developer",
  "criteriaRevision": 1,
  "producer": {
    "role": "developer"
  },
  "items": [
    {
      "id": "T1-E1",
      "label": l("Two accounts keep separate preferences", "Deux comptes gardent des préférences séparées"),
      "verdict": "measured",
      "criterionIds": [
        "AC1"
      ],
      "taskIds": [
        "T1"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:12:00.000Z",
      "codeSnapshotId": "snap-demo-5c1e0a7d9f2b",
      "codeSnapshotAtEnd": "snap-demo-5c1e0a7d9f2b",
      "expected": l("independent settings", "réglages indépendants"),
      "actual": l("account B unchanged after changing account A", "compte B inchangé après modification du compte A")
    },
    {
      "id": "T2-E1",
      "label": l("Critical alerts stay visible when notifications are turned off", "Les alertes critiques restent visibles quand les notifications sont désactivées"),
      "verdict": "measured",
      "criterionIds": [
        "AC2"
      ],
      "checkIds": [
        "AC2-C1"
      ],
      "taskIds": [
        "T2"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:14:00.000Z",
      "codeSnapshotId": "snap-demo-5c1e0a7d9f2b",
      "codeSnapshotAtEnd": "snap-demo-5c1e0a7d9f2b",
      "expected": l("critical alert displayed", "alerte critique affichée"),
      "actual": l("critical alert displayed", "alerte critique affichée"),
      "screenshot": "assets/panneau-preferences.png",
      "note": l("Route /settings, viewport 1280x900", "Route /settings, viewport 1280x900")
    },
    {
      "id": "T3-E1",
      "label": l("The panel saves preferences without a reload", "Le panneau enregistre les préférences sans rechargement"),
      "verdict": "measured",
      "criterionIds": [
        "AC3"
      ],
      "taskIds": [
        "T3"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:16:00.000Z",
      "codeSnapshotId": "snap-demo-5c1e0a7d9f2b",
      "codeSnapshotAtEnd": "snap-demo-5c1e0a7d9f2b",
      "actual": l("PATCH /api/preferences → 200, local state updated without a reload", "PATCH /api/preferences → 200, état local mis à jour sans rechargement")
    }
  ]
},
  qaRoundOne: {
  "schemaVersion": 2,
  "source": "qa",
  "status": "FAIL",
  "round": 1,
  "criteriaRevision": 1,
  "producer": {
    "role": "qa-reviewer"
  },
  "codeSnapshot": {
    "atStart": "snap-demo-5c1e0a7d9f2b",
    "atEnd": "snap-demo-5c1e0a7d9f2b"
  },
  "items": [
    {
      "id": "QA-R1-1",
      "label": "Lint",
      "verdict": "pass",
      "method": "static_analysis",
      "command": "npm run lint",
      "actual": l("0 warnings", "0 avertissement")
    },
    {
      "id": "QA-R1-2",
      "label": "Typecheck",
      "verdict": "pass",
      "method": "static_analysis",
      "command": "npm run typecheck",
      "actual": l("0 errors", "0 erreur")
    },
    {
      "id": "QA-R1-3",
      "label": l("Unit tests", "Tests unitaires"),
      "verdict": "pass",
      "method": "test",
      "command": "npm run test",
      "actual": "11/11"
    },
    {
      "id": "QA-R1-4",
      "label": l("Critical alert near midnight in UTC+2", "Alerte critique près de minuit en UTC+2"),
      "verdict": "fail",
      "criterionIds": [
        "AC2"
      ],
      "checkIds": [
        "AC2-C2"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:20:00.000Z",
      "expected": l("alert displayed", "alerte affichée"),
      "actual": l("alert hidden at 11:30 pm", "alerte masquée à 23 h 30"),
      "screenshot": "assets/alerte-critique.png"
    },
    {
      "id": "QA-R1-5",
      "label": l("Preferences picked up on mobile", "Préférences reprises sur mobile"),
      "verdict": "unverified",
      "criterionIds": [
        "AC5"
      ],
      "method": "manual",
      "blocker": {
        "reason": l("Mobile staging environment unreachable.", "Environnement de staging mobile inaccessible."),
        "action": l("Provide a mobile staging build linked to this branch.", "Fournir un build de staging mobile lié à cette branche.")
      }
    },
    {
      "id": "QA-R1-6",
      "kind": "attempt",
      "label": l("Change account A while account B is open", "Modifier le compte A pendant que le compte B est ouvert"),
      "verdict": "pass",
      "criterionIds": [
        "AC1"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:21:00.000Z",
      "expected": l("account B settings unchanged", "réglages du compte B inchangés"),
      "command": l("Open /settings with accounts A and B, turn off emails on A, reload B", "Ouvrir /settings avec les comptes A et B, désactiver les emails sur A, recharger B"),
      "actual": l("account B settings unchanged", "réglages du compte B inchangés")
    }
  ]
},
  qaRoundTwo: {
  "schemaVersion": 2,
  "source": "qa",
  "status": "FAIL",
  "round": 2,
  "criteriaRevision": 1,
  "producer": {
    "role": "qa-reviewer"
  },
  "codeSnapshot": {
    "atStart": "snap-demo-9b04f3e2a61c",
    "atEnd": "snap-demo-9b04f3e2a61c"
  },
  "items": [
    {
      "id": "QA-R2-1",
      "label": "Lint",
      "verdict": "pass",
      "method": "static_analysis",
      "command": "npm run lint",
      "actual": l("0 warnings", "0 avertissement")
    },
    {
      "id": "QA-R2-2",
      "label": "Typecheck",
      "verdict": "pass",
      "method": "static_analysis",
      "command": "npm run typecheck",
      "actual": l("0 errors", "0 erreur")
    },
    {
      "id": "QA-R2-3",
      "label": l("Unit tests", "Tests unitaires"),
      "verdict": "pass",
      "method": "test",
      "command": "npm run test",
      "actual": "12/12"
    },
    {
      "id": "QA-R2-4",
      "label": l("Critical alert near midnight in UTC+2", "Alerte critique près de minuit en UTC+2"),
      "verdict": "pass",
      "criterionIds": [
        "AC2"
      ],
      "checkIds": [
        "AC2-C2"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:41:00.000Z",
      "expected": l("alert displayed", "alerte affichée"),
      "actual": l("alert displayed at 11:30 pm", "alerte affichée à 23 h 30"),
      "screenshot": "assets/alerte-critique.png",
      "supersedes": [
        "QA-R1-4"
      ]
    },
    {
      "id": "QA-R2-5",
      "label": l("Alert visible with notifications off", "Alerte visible avec les notifications désactivées"),
      "verdict": "measured",
      "criterionIds": [
        "AC2"
      ],
      "checkIds": [
        "AC2-C1"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:42:00.000Z",
      "expected": l("critical alert displayed", "alerte critique affichée"),
      "actual": l("critical alert displayed", "alerte critique affichée"),
      "screenshot": "assets/panneau-preferences.png"
    },
    {
      "id": "QA-R2-6",
      "label": l("Two accounts keep separate preferences", "Deux comptes gardent des préférences séparées"),
      "verdict": "measured",
      "criterionIds": [
        "AC1"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:43:00.000Z",
      "expected": l("independent settings", "réglages indépendants"),
      "actual": l("account B unchanged", "compte B inchangé")
    },
    {
      "id": "QA-R2-7",
      "kind": "attempt",
      "label": l("Double click on Save", "Double clic sur Enregistrer"),
      "verdict": "fail",
      "criterionIds": [
        "AC4"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:44:00.000Z",
      "expected": l("1 PATCH request", "1 requête PATCH"),
      "command": l("Open /settings, double-click Save, read the Network tab", "Ouvrir /settings, double-cliquer sur Enregistrer, lire l'onglet Network"),
      "actual": l("2 PATCH requests observed", "2 requêtes PATCH observées")
    },
    {
      "id": "QA-R2-8",
      "label": l("Preferences picked up on mobile", "Préférences reprises sur mobile"),
      "verdict": "unverified",
      "criterionIds": [
        "AC5"
      ],
      "method": "manual",
      "supersedes": [
        "QA-R1-5"
      ],
      "blocker": {
        "reason": l("Mobile staging environment still unreachable.", "Environnement de staging mobile toujours inaccessible."),
        "action": l("Provide a mobile staging build linked to this branch.", "Fournir un build de staging mobile lié à cette branche.")
      }
    },
    {
      "id": "QA-R2-9",
      "label": l("Setting takes effect without a reload", "Le réglage prend effet sans rechargement"),
      "verdict": "confirmed",
      "criterionIds": [
        "AC3"
      ],
      "method": "browser",
      "confirms": "T3-E1",
      "actual": l("PATCH /api/preferences → 200 according to the developer's measurement, taken before the rework", "PATCH /api/preferences → 200 d'après la mesure du developer, prise avant la reprise")
    },
    {
      "id": "QA-R2-10",
      "kind": "attempt",
      "label": l("Switch accounts without reloading the page", "Changer de compte sans recharger la page"),
      "verdict": "pass",
      "criterionIds": [
        "AC1"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:45:00.000Z",
      "expected": l("account B settings displayed", "réglages du compte B affichés"),
      "command": l("Open /settings with account A, log out, log in with account B without reloading", "Ouvrir /settings avec le compte A, se déconnecter, se connecter avec le compte B sans recharger"),
      "actual": l("account B settings displayed", "réglages du compte B affichés"),
      "supersedes": [
        "QA-R1-6"
      ]
    },
    {
      "id": "QA-R2-11",
      "kind": "attempt",
      "label": l("Critical alert at midnight sharp in UTC-11", "Alerte critique à minuit pile en UTC-11"),
      "verdict": "pass",
      "criterionIds": [
        "AC2"
      ],
      "checkIds": [
        "AC2-C2"
      ],
      "method": "test",
      "observedAt": "2026-09-27T09:46:00.000Z",
      "expected": l("alert displayed", "alerte affichée"),
      "command": "TZ=Pacific/Pago_Pago npm run test -- critical-alerts",
      "actual": l("alert displayed, 1 test out of 1", "alerte affichée, 1 test sur 1")
    },
    {
      "id": "QA-R2-12",
      "kind": "attempt",
      "label": l("Unknown preference field sent by the mobile app", "Champ de préférence inconnu envoyé par l'application mobile"),
      "verdict": "unverified",
      "criterionIds": [
        "AC5"
      ],
      "method": "static_analysis",
      "expected": l("unknown field ignored, known settings picked up", "champ inconnu ignoré, réglages connus repris"),
      "command": l("Reading src/settings/preferences-model.ts:41", "Lecture de src/settings/preferences-model.ts:41"),
      "actual": l("the model ignores unknown fields on read, not executed for lack of a mobile build", "le modèle ignore les champs inconnus à la lecture, non exécuté faute de build mobile")
    }
  ]
},
  design: {
    "schemaVersion": 2,
    "source": "design",
    "round": 1,
    "criteriaRevision": 1,
    "producer": {
      "role": "designer-reviewer"
    },
    "codeSnapshot": {
      "atStart": "snap-demo-9b04f3e2a61c"
    },
    "items": [
      {
        "id": "DS-R1-1",
        "label": l("Vertical spacing between the toggles of the preferences panel, 1280 px, rest", "Espacement vertical entre les interrupteurs du panneau de préférences, 1280 px, repos"),
        "verdict": "pass",
        "method": "browser",
        "expected": l("16 px (mockup of ticket IH-42)", "16 px (maquette du ticket IH-42)"),
        "actual": "16 px",
        "screenshot": "assets/panneau-preferences.png",
        "attachments": [
          "assets/reference-panneau-preferences.png"
        ]
      },
      {
        "id": "DS-R1-2",
        "label": l("Keyboard focus ring of the email notifications toggle, 1280 px", "Anneau de focus clavier de l'interrupteur des notifications par email, 1280 px"),
        "verdict": "pass",
        "method": "browser",
        "expected": l("visible ring, contrast of at least 3:1 (WCAG 2.4.7 and 1.4.11)", "anneau visible, contraste d'au moins 3:1 (WCAG 2.4.7 et 1.4.11)"),
        "actual": l("2 px ring, contrast 4.6:1", "anneau de 2 px, contraste 4,6:1"),
        "screenshot": "assets/panneau-preferences.png"
      },
      {
        "id": "DS-R1-3",
        "label": l("Preferences panel at 360 px, rest", "Panneau de préférences à 360 px, repos"),
        "verdict": "unverified",
        "method": "browser",
        "expected": l("toggles stacked in one column (mockup of ticket IH-42)", "interrupteurs empilés sur une colonne (maquette du ticket IH-42)"),
        "blocker": {
          "reason": l("The staging environment does not serve the panel below 768 px.", "L'environnement de staging ne sert pas le panneau en dessous de 768 px."),
          "action": l("Enable the /settings route on the mobile staging template.", "Activer la route /settings sur le template de staging mobile.")
        }
      }
    ]
  },
  captures: CAPTURES,
  };
}

const PROSE_EN = {
  "ticket-context.md": `# IH-42 · Notification preferences

## Goal
Let each user choose which notifications they receive while keeping critical alerts.

## Acceptance criteria
- Preferences are saved per user.
- Critical alerts stay on.
- The setting takes effect without reloading the page.`,
  "implementation-plan.md": `# Implementation plan

1. Add the preferences model.
2. Create the settings panel.
3. Wire up optimistic saving.
4. Add the tests for the critical fallback.
5. Check accessibility and error states.`,
  "developer-report.md": `# Implementation report

- Preferences model added.
- Form wired to the server.
- Optimistic update with rollback on failure.
- Unit tests added.

Status: ready for review.`,
  "senior-review-round-1.md": `# Review 1/2 · Changes requested

## Findings
1. The critical alerts fallback ignores the user's time zone.
2. No test covers this regression case.

Decision: fixes required before approval.`,
  "senior-review-round-2.md": `# Review 2/2 · Blocked

Both findings from the first round are resolved:

- the fallback now uses the user's time zone;
- a regression test covers this behavior.

Still open:

- **P0**: AC4 is not met, a double click on Save sends two PATCH requests (\`settings/panel.tsx:88\`).

Limit of two rounds reached.

Decision: blocked. The merge request is opened as a draft, with AC4 in its Blocked section.`,
  "qa-plan.md": `# QA test plan

## Round 1

### Behavior matrix

| Criterion | Expected behavior | Planned observation |
|---|---|---|
| AC1 | A second account does not see the first one's settings | Two accounts in two sessions, change A, read B again |
| AC2 | The critical alert stays displayed, notifications off, whatever the time zone | Turn off notifications, trigger an alert at 11:30 pm in UTC+2 |
| AC3 | The setting applies without a reload | Change a setting, read the Network tab and the displayed state |
| AC4 | A double click sends only one request | Double click on Save, count the PATCH requests |
| AC5 | The mobile app picks up the preferences | Open the mobile staging build after a change on the web |

### Risk grid

- User input: triggered (toggles, Save button).
- Network call: triggered (PATCH /api/preferences).
- Persistent state: triggered (per-user preferences).
- Asynchronous: triggered (optimistic update).
- Data or migration: triggered (new model).
- Permissions: triggered (isolation between accounts).
- Observable security: not triggered, no new surface exposed.
- Accessibility: triggered (panel with the keyboard), covered by the design review.

### Defect hypotheses

| Criterion | Hypothesis | Trigger | Expected result |
|---|---|---|---|
| AC1 | Settings are read from a cache shared between sessions | Change account A while account B is open | Account B settings unchanged |
| AC2 | The fallback compares dates in UTC | Alert at 11:30 pm in UTC+2 | Alert displayed |
| AC3 | The local state is only updated on reload | Change a setting without reloading | New state displayed |
| AC4 | The button stays enabled while the request is being sent | Double click on Save | 1 PATCH request |
| AC5 | The mobile client rejects a field it does not know | Send a preference added by the web | Field ignored, known settings picked up |

## Round 2

### Behavior matrix

Unchanged. AC2 is to be observed again on the reworked code.

### Defect hypotheses

| Criterion | Hypothesis | Trigger | Expected result |
|---|---|---|---|
| AC1 | The previous account's state stays in memory after switching accounts | Switch accounts without reloading | Account B settings displayed |
| AC2 | The fix only holds for time zones east of UTC | Alert at midnight sharp in UTC-11 | Alert displayed |`,
  "qa-report.md": `# QA report

## Verdict

FAIL

AC4 is not met: a double click on Save sends two PATCH requests. AC3 and AC5 remain unverified.

## Checks

| Check | Command run | Result | Evidence |
|---|---|---|---|
| Lint | \`npm run lint\` | pass | 0 warnings |
| Typecheck | \`npm run typecheck\` | pass | 0 errors |
| Unit tests | \`npm run test\` | pass | 12/12 |
| Integration tests | none | not run | the simulated project has no integration suite |
| Visual (Playwright) | /settings, 1280x900 | pass | assets/panneau-preferences.png, assets/alerte-critique.png |

## Observable criteria

| Criterion | Verdict | Value read | Backend | Evidence |
|---|---|---|---|---|
| AC1 | measured live | account B unchanged | real | live observation, two sessions |
| AC2 (AC2-C1) | measured live | critical alert displayed | real | assets/panneau-preferences.png |
| AC2 (AC2-C2) | measured live | alert displayed at 11:30 pm | real | assets/alerte-critique.png |
| AC3 | confirmed from the developer's evidence | PATCH /api/preferences → 200 | real | T3-E1, taken before the rework |
| AC5 | unverified | none | real | mobile staging build unreachable |

## Acceptance criteria

- AC1: MET, two accounts keep separate settings (measured live).
- AC2: MET, the critical alert stays displayed at 11:30 pm in UTC+2, the round 1 failure is replaced.
- AC3: UNVERIFIED, only the developer's measurement exists, taken before the rework.
- AC4: NOT MET, a double click sends two PATCH requests.
- AC5: UNVERIFIED, mobile staging environment unreachable.

## Break attempts

| Criterion | Defect hypothesis | Trigger | Expected | Observed | Mode |
|---|---|---|---|---|---|
| AC1 | The previous account's state stays in memory | Switch accounts without reloading the page | account B settings displayed | account B settings displayed | executed |
| AC2 | The fix only holds for time zones east of UTC | \`TZ=Pacific/Pago_Pago npm run test -- critical-alerts\` | alert displayed | alert displayed, 1 test out of 1 | executed |
| AC4 | The button stays enabled while the request is being sent | Double click on Save | 1 PATCH request | 2 PATCH requests observed | executed |
| AC5 | The mobile client rejects an unknown field | Reading \`src/settings/preferences-model.ts:41\` | unknown field ignored | the model ignores unknown fields on read | read |

## Issues

**P0**: double save on double click

- Requirement violated: criterion \`AC4\`, ticket IH-42
- Reproduced; introduced by the diff
- Steps to reproduce: open /settings, change a setting, double-click Save
- Expected: 1 PATCH request
- Observed: 2 PATCH requests (\`settings/panel.tsx:88\`)

## Coverage

- Risk grid: user input tested (failure on the double click); network call tested (PATCH observed); persistent state tested (AC1); asynchronous tested (failure on AC4); data or migration not tested, no staging database to migrate; permissions tested (isolation between accounts); observable security not applicable, no new surface; accessibility not applicable here, covered by the design review
- Consumers of the modified symbols: the alerts banner reads the preferences, smoke check passed on /dashboard
- Reruns: the time zone regression test was run 3 times, 3 passes, no order dependency observed
- Scenarios tested: isolation between accounts, alert near midnight in two time zones, double click
- Missing scenarios: AC3 with no executed attempt, the live measurement was not redone after the rework; AC5 with no executed attempt, mobile build unreachable

## Reconciliation

- Scenario added after reading the developer report: smoke check of the alerts banner.
- Hypothesis dropped: none.
- Claim contradicted: the developer report says saving happens without a double send, the attempt on AC4 shows two requests.
- Remaining risk from the senior reviewer, time zone: tested, AC2 row of the attempts.

## Not verifiable

- AC3: no live observation on the reworked code. The setting change has to be replayed in the browser.
- AC5: mobile staging environment unreachable. A mobile staging build linked to this branch is needed.`,
  "design-inventory.md": `# Design inventory

Reference level: ticket-mockup (mockup attached to ticket IH-42).

| Element | Source | Viewports | States and content | In scope |
|---|---|---|---|---|
| List of toggles of the preferences panel | ticket mockup | 360, 768, 1280 | rest, long content | yes |
| Email notifications toggle | ticket mockup | 1280 | rest, hover, keyboard focus, active, disabled | yes |
| Save button | ticket mockup | 1280 | rest, keyboard focus, loading | yes |
| Critical alert banner | neighboring screen /dashboard | 1280 | rest | no |`,
  "designer-review.md": `# Design review

## Summary

- Reference level: ticket-mockup, the mockup attached to ticket IH-42
- Overall assessment: the panel follows the mockup at 1280 px, the mobile width could not be reached

## Inspection method

- Reference: read in full
- Live app: inspected through Playwright
- Recipe: provided
- Dark theme and reduced motion: not supported
- Consumer routes: not requested
- Confidence level: medium

## Coverage matrix

| Screen | Viewport | State or content | Coverage | Screenshots (reference, live) | Obstacle |
| --- | --- | --- | --- | --- | --- |
| Preferences panel | 1280 | rest | measured | assets/reference-panneau-preferences.png, assets/panneau-preferences.png | |
| Preferences panel | 1280 | keyboard focus | measured | assets/panneau-preferences.png | invariant, no reference screenshot |
| Preferences panel | 360 | rest | not reached | | staging does not serve the panel below 768 px |

- Inventory rows in scope: 3, of which measured: 2 (67%)

## State matrix

| Element | Rest | Hover | Keyboard focus | Active | Disabled | Loading | Empty | Error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Email notifications toggle | compliant | not reached | compliant | not reached | not reached | n/a | n/a | n/a |
| Save button | compliant | not reached | not reached | not reached | n/a | not reached | n/a | n/a |

## Accessibility

| Check | Element | Threshold | Measured | Result |
| --- | --- | --- | --- | --- |
| visible focus | Email notifications toggle | contrast 3:1 (WCAG 1.4.11) | 4.6:1 | compliant |

## Gaps with the developer's measurements

- Inventory elements, states or viewports the developer did not measure: 360 px, keyboard focus
- Measured by the developer and absent from the inventory: none
- Values in disagreement: none

## Blocking issues (P0)

None

## Major issues (P1)

None

## Minor issues (P2)

None

## Pre-existing gaps (elements the ticket does not touch)

None

## Conflicts to arbitrate

None

## To be checked by QA

- Double-click Save: the button does not switch to the loading state between the two clicks, observed at 1280 px. Clue to the app state: two PATCH rows in the Network tab.

## Observations without a reference

None

## Verdict

INCONCLUSIVE`,
  "developer-report-T1.md": "# T1 · Preferences model\n\nModel and migration added, 3 tests.",
  "developer-report-T2.md": "# T2 · Settings panel\n\nPanel usable with the keyboard, 4 tests.",
  "developer-report-T3.md": "# T3 · Optimistic saving\n\nOptimistic update with rollback on error, 3 tests.",
  "developer-report-T4.md": "# T4 · Critical alerts fallback\n\nTime zone taken into account, regression test added.",
  "mr-description.md": `# Draft: IH-42 · Add notification preferences

## Blocked
- AC4: a double click on Save sends two PATCH requests. Still failed after the two review rounds.
- AC5: blocked, the mobile staging environment was unreachable.

## Changes
- Added the preferences panel.
- Optimistic saving of the settings.
- Critical alerts kept.
- Addressed the review findings on the time zone.

## Validation
- 12 tests pass.
- 2 criteria verified out of 5: AC1 and AC2. AC3 remains unverified, its only measurement predates the rework.
- Senior review blocked on the second round on AC4.`,
};

type DemoProse = Record<keyof typeof PROSE_EN, string>;

const PROSE_FR: DemoProse = {
  "ticket-context.md": `# IH-42 · Préférences de notification

## Objectif
Laisser chaque utilisateur choisir les notifications qu'il reçoit tout en conservant les alertes critiques.

## Critères d'acceptation
- Les préférences sont enregistrées par utilisateur.
- Les alertes critiques restent actives.
- Le réglage prend effet sans recharger la page.`,
  "implementation-plan.md": `# Plan d'implémentation

1. Ajouter le modèle de préférences.
2. Créer le panneau de réglages.
3. Brancher l'enregistrement optimiste.
4. Ajouter les tests du repli des alertes critiques.
5. Vérifier l'accessibilité et les états d'erreur.`,
  "developer-report.md": `# Rapport d'implémentation

- Modèle de préférences ajouté.
- Formulaire branché sur le serveur.
- Mise à jour optimiste avec annulation en cas d'échec.
- Tests unitaires ajoutés.

Statut : prêt pour la revue.`,
  "senior-review-round-1.md": `# Revue 1/2 · Modifications demandées

## Constats
1. Le repli des alertes critiques ignore le fuseau horaire de l'utilisateur.
2. Aucun test ne couvre ce cas de régression.

Décision : corrections requises avant approbation.`,
  "senior-review-round-2.md": `# Revue 2/2 · Bloquée

Les deux constats du premier tour sont résolus :

- le repli utilise maintenant le fuseau horaire de l'utilisateur ;
- un test de non-régression couvre ce comportement.

Reste ouvert :

- **P0** : AC4 n'est pas respecté, un double clic sur Enregistrer envoie deux requêtes PATCH (\`settings/panel.tsx:88\`).

Limite de deux tours atteinte.

Décision : bloquée. La merge request est ouverte en brouillon, avec AC4 dans sa section Bloqué.`,
  "qa-plan.md": `# Plan de test QA

## Tour 1

### Matrice de comportements

| Critère | Comportement attendu | Observation prévue |
|---|---|---|
| AC1 | Un second compte ne voit pas les réglages du premier | Deux comptes dans deux sessions, modifier A, relire B |
| AC2 | L'alerte critique reste affichée, notifications désactivées, quel que soit le fuseau horaire | Désactiver les notifications, déclencher une alerte à 23 h 30 en UTC+2 |
| AC3 | Le réglage s'applique sans rechargement | Modifier un réglage, lire l'onglet Network et l'état affiché |
| AC4 | Un double clic n'envoie qu'une seule requête | Double clic sur Enregistrer, compter les requêtes PATCH |
| AC5 | L'application mobile reprend les préférences | Ouvrir le build de staging mobile après un changement sur le web |

### Grille de risques

- Saisie utilisateur : déclenchée (interrupteurs, bouton Enregistrer).
- Appel réseau : déclenché (PATCH /api/preferences).
- État persistant : déclenché (préférences par utilisateur).
- Asynchrone : déclenché (mise à jour optimiste).
- Données ou migration : déclenché (nouveau modèle).
- Permissions : déclenché (isolation entre comptes).
- Sécurité observable : non déclenché, aucune nouvelle surface exposée.
- Accessibilité : déclenché (panneau au clavier), couvert par la revue design.

### Hypothèses de défaut

| Critère | Hypothèse | Déclencheur | Résultat attendu |
|---|---|---|---|
| AC1 | Les réglages sont lus depuis un cache partagé entre sessions | Modifier le compte A pendant que le compte B est ouvert | Réglages du compte B inchangés |
| AC2 | Le repli compare les dates en UTC | Alerte à 23 h 30 en UTC+2 | Alerte affichée |
| AC3 | L'état local n'est mis à jour qu'au rechargement | Modifier un réglage sans recharger | Nouvel état affiché |
| AC4 | Le bouton reste actif pendant l'envoi de la requête | Double clic sur Enregistrer | 1 requête PATCH |
| AC5 | Le client mobile rejette un champ qu'il ne connaît pas | Envoyer une préférence ajoutée par le web | Champ ignoré, réglages connus repris |

## Tour 2

### Matrice de comportements

Inchangée. AC2 est à observer de nouveau sur le code repris.

### Hypothèses de défaut

| Critère | Hypothèse | Déclencheur | Résultat attendu |
|---|---|---|---|
| AC1 | L'état du compte précédent reste en mémoire après un changement de compte | Changer de compte sans recharger | Réglages du compte B affichés |
| AC2 | Le correctif ne tient que pour les fuseaux à l'est de UTC | Alerte à minuit pile en UTC-11 | Alerte affichée |`,
  "qa-report.md": `# Rapport QA

## Verdict

FAIL

AC4 n'est pas respecté : un double clic sur Enregistrer envoie deux requêtes PATCH. AC3 et AC5 restent non vérifiés.

## Contrôles

| Contrôle | Commande exécutée | Résultat | Preuve |
|---|---|---|---|
| Lint | \`npm run lint\` | pass | 0 avertissement |
| Typecheck | \`npm run typecheck\` | pass | 0 erreur |
| Tests unitaires | \`npm run test\` | pass | 12/12 |
| Tests d'intégration | aucune | not run | le projet simulé n'a pas de suite d'intégration |
| Visuel (Playwright) | /settings, 1280x900 | pass | assets/panneau-preferences.png, assets/alerte-critique.png |

## Critères observables

| Critère | Verdict | Valeur lue | Backend | Preuve |
|---|---|---|---|---|
| AC1 | mesuré en direct | compte B inchangé | réel | observation en direct, deux sessions |
| AC2 (AC2-C1) | mesuré en direct | alerte critique affichée | réel | assets/panneau-preferences.png |
| AC2 (AC2-C2) | mesuré en direct | alerte affichée à 23 h 30 | réel | assets/alerte-critique.png |
| AC3 | confirmé depuis les preuves du developer | PATCH /api/preferences → 200 | réel | T3-E1, pris avant la reprise |
| AC5 | non vérifié | aucune | réel | build de staging mobile inaccessible |

## Critères d'acceptation

- AC1 : MET, deux comptes gardent des réglages séparés (mesuré en direct).
- AC2 : MET, l'alerte critique reste affichée à 23 h 30 en UTC+2, l'échec du tour 1 est remplacé.
- AC3 : UNVERIFIED, il n'existe que la mesure du developer, prise avant la reprise.
- AC4 : NOT MET, un double clic envoie deux requêtes PATCH.
- AC5 : UNVERIFIED, environnement de staging mobile inaccessible.

## Tentatives de casse

| Critère | Hypothèse de défaut | Déclencheur | Attendu | Observé | Mode |
|---|---|---|---|---|---|
| AC1 | L'état du compte précédent reste en mémoire | Changer de compte sans recharger la page | réglages du compte B affichés | réglages du compte B affichés | exécuté |
| AC2 | Le correctif ne tient que pour les fuseaux à l'est de UTC | \`TZ=Pacific/Pago_Pago npm run test -- critical-alerts\` | alerte affichée | alerte affichée, 1 test sur 1 | exécuté |
| AC4 | Le bouton reste actif pendant l'envoi de la requête | Double clic sur Enregistrer | 1 requête PATCH | 2 requêtes PATCH observées | exécuté |
| AC5 | Le client mobile rejette un champ inconnu | Lecture de \`src/settings/preferences-model.ts:41\` | champ inconnu ignoré | le modèle ignore les champs inconnus à la lecture | lu |

## Problèmes

**P0** : double enregistrement au double clic

- Exigence violée : critère \`AC4\`, ticket IH-42
- Reproduit ; introduit par le diff
- Étapes pour reproduire : ouvrir /settings, modifier un réglage, double-cliquer sur Enregistrer
- Attendu : 1 requête PATCH
- Observé : 2 requêtes PATCH (\`settings/panel.tsx:88\`)

## Couverture

- Grille de risques : saisie utilisateur testée (échec au double clic) ; appel réseau testé (PATCH observé) ; état persistant testé (AC1) ; asynchrone testé (échec sur AC4) ; données ou migration non testées, pas de base de staging à migrer ; permissions testées (isolation entre comptes) ; sécurité observable non applicable, aucune nouvelle surface ; accessibilité non applicable ici, couverte par la revue design
- Consommateurs des symboles modifiés : la bannière d'alertes lit les préférences, smoke check passé sur /dashboard
- Rejeux : le test de non-régression sur le fuseau horaire a été rejoué 3 fois, 3 succès, aucune dépendance à l'ordre observée
- Scénarios testés : isolation entre comptes, alerte près de minuit dans deux fuseaux horaires, double clic
- Scénarios manquants : AC3 sans tentative exécutée, la mesure en direct n'a pas été refaite après la reprise ; AC5 sans tentative exécutée, build mobile inaccessible

## Réconciliation

- Scénario ajouté après lecture du rapport du developer : smoke check de la bannière d'alertes.
- Hypothèse abandonnée : aucune.
- Affirmation contredite : le rapport du developer dit que l'enregistrement se fait sans double envoi, la tentative sur AC4 montre deux requêtes.
- Risque restant signalé par le senior reviewer, fuseau horaire : testé, ligne AC2 des tentatives.

## Non vérifiable

- AC3 : aucune observation en direct sur le code repris. Le changement de réglage doit être rejoué dans le navigateur.
- AC5 : environnement de staging mobile inaccessible. Il faut un build de staging mobile lié à cette branche.`,
  "design-inventory.md": `# Inventaire design

Niveau de référence : ticket-mockup (maquette jointe au ticket IH-42).

| Élément | Source | Viewports | États et contenu | Dans le périmètre |
|---|---|---|---|---|
| Liste des interrupteurs du panneau de préférences | maquette du ticket | 360, 768, 1280 | repos, contenu long | oui |
| Interrupteur des notifications par email | maquette du ticket | 1280 | repos, survol, focus clavier, actif, désactivé | oui |
| Bouton Enregistrer | maquette du ticket | 1280 | repos, focus clavier, chargement | oui |
| Bannière d'alerte critique | écran voisin /dashboard | 1280 | repos | non |`,
  "designer-review.md": `# Revue design

## Résumé

- Niveau de référence : ticket-mockup, la maquette jointe au ticket IH-42
- Appréciation générale : le panneau suit la maquette à 1280 px, la largeur mobile n'a pas pu être atteinte

## Méthode d'inspection

- Référence : lue en entier
- Application en direct : inspectée avec Playwright
- Recette : fournie
- Thème sombre et mouvement réduit : non pris en charge
- Routes consommatrices : non demandées
- Niveau de confiance : moyen

## Matrice de couverture

| Écran | Viewport | État ou contenu | Couverture | Captures (référence, direct) | Obstacle |
| --- | --- | --- | --- | --- | --- |
| Panneau de préférences | 1280 | repos | mesuré | assets/reference-panneau-preferences.png, assets/panneau-preferences.png | |
| Panneau de préférences | 1280 | focus clavier | mesuré | assets/panneau-preferences.png | invariant, pas de capture de référence |
| Panneau de préférences | 360 | repos | non atteint | | le staging ne sert pas le panneau en dessous de 768 px |

- Lignes d'inventaire dans le périmètre : 3, dont mesurées : 2 (67 %)

## Matrice d'états

| Élément | Repos | Survol | Focus clavier | Actif | Désactivé | Chargement | Vide | Erreur |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Interrupteur des notifications par email | conforme | non atteint | conforme | non atteint | non atteint | n/a | n/a | n/a |
| Bouton Enregistrer | conforme | non atteint | non atteint | non atteint | n/a | non atteint | n/a | n/a |

## Accessibilité

| Contrôle | Élément | Seuil | Mesuré | Résultat |
| --- | --- | --- | --- | --- |
| focus visible | Interrupteur des notifications par email | contraste 3:1 (WCAG 1.4.11) | 4,6:1 | conforme |

## Écarts avec les mesures du developer

- Éléments, états ou viewports de l'inventaire que le developer n'a pas mesurés : 360 px, focus clavier
- Mesuré par le developer et absent de l'inventaire : aucun
- Valeurs en désaccord : aucune

## Problèmes bloquants (P0)

Aucun

## Problèmes majeurs (P1)

Aucun

## Problèmes mineurs (P2)

Aucun

## Écarts préexistants (éléments que le ticket ne touche pas)

Aucun

## Conflits à arbitrer

Aucun

## À vérifier par la QA

- Double clic sur Enregistrer : le bouton ne passe pas à l'état de chargement entre les deux clics, observé à 1280 px. Indice sur l'état de l'application : deux lignes PATCH dans l'onglet Network.

## Observations sans référence

Aucune

## Verdict

INCONCLUSIVE`,
  "developer-report-T1.md": "# T1 · Modèle de préférences\n\nModèle et migration ajoutés, 3 tests.",
  "developer-report-T2.md": "# T2 · Panneau de réglages\n\nPanneau utilisable au clavier, 4 tests.",
  "developer-report-T3.md": "# T3 · Enregistrement optimiste\n\nMise à jour optimiste avec annulation en cas d'erreur, 3 tests.",
  "developer-report-T4.md": "# T4 · Repli des alertes critiques\n\nFuseau horaire pris en compte, test de non-régression ajouté.",
  "mr-description.md": `# Brouillon : IH-42 · Ajouter des préférences de notification

## Bloqué
- AC4 : un double clic sur Enregistrer envoie deux requêtes PATCH. Toujours en échec après les deux tours de revue.
- AC5 : bloqué, l'environnement de staging mobile était inaccessible.

## Changements
- Ajout du panneau de préférences.
- Enregistrement optimiste des réglages.
- Alertes critiques conservées.
- Prise en compte des remarques de revue sur le fuseau horaire.

## Validation
- 12 tests passent.
- 2 critères vérifiés sur 5 : AC1 et AC2. AC3 reste non vérifié, sa seule mesure précède la reprise.
- Revue senior bloquée au second tour sur AC4.`,
};

const TEST_REPORT = `{
  "status": "passed",
  "tests": 11,
  "passed": 11,
  "failed": 0
}`;

const TEST_REPORT_ROUND_2 = `{
  "status": "passed",
  "tests": 12,
  "passed": 12,
  "failed": 0,
  "regressionTest": "critical-alert-timezone"
}`;

/** The documents of a simulated run, keyed by the name the run lists them under, in the run's language. */
export function demoArtifactContentsOf(language: Language): Record<string, string> {
  const acceptance = demoAcceptanceOf(language);
  return {
    ...(language === "fr" ? PROSE_FR : PROSE_EN),
    "test-report.json": TEST_REPORT,
    "test-report-round-2.json": TEST_REPORT_ROUND_2,
    "dev-evidence.json": JSON.stringify(acceptance.developer, null, 2),
    "assets/panneau-preferences.png": PANEL_CAPTURE,
    "qa-evidence.json": JSON.stringify(acceptance.qaRoundTwo, null, 2),
    "qa-evidence-round1.json": JSON.stringify(acceptance.qaRoundOne, null, 2),
    "acceptance-criteria.json": JSON.stringify(acceptance.criteria, null, 2),
    "assets/alerte-critique.png": acceptance.captures.roundTwo,
    "assets/reference-panneau-preferences.png": acceptance.captures.reference,
    "design-evidence.json": JSON.stringify(acceptance.design, null, 2),
    "planner-output.json": JSON.stringify(acceptance.plan, null, 2),
  };
}

/** The English documents, for the readers that have no run language to hand. */
export const demoArtifactContents = demoArtifactContentsOf("en");


/**
 * What a simulated run "consumed": there is no transcript to read, so the
 * figures are derived from how far the run got, and grow as it goes. The
 * shape is the one of a real small run: a pilot that starts near 70,000
 * tokens of context and reads it again on every call.
 */
export function demoSessionUsage(state: Pick<RunState, "id" | "agents" | "activities" | "phase">): SessionUsage[] {
  if (state.phase === 0) return [];
  const session = (calls: number, context: number, growth: number, model: string) => ({
    calls, model, inputTokens: calls * 4, outputTokens: calls * 620,
    cacheReadTokens: calls * context + growth * (calls * (calls - 1)) / 2, cacheWriteTokens: context + calls * growth,
    firstContextTokens: context, peakContextTokens: context + growth * calls,
  });
  const sessionId = state.id ?? "demo";
  const pilotCalls = 2 + state.activities.length;
  return [
    { sessionId, ...session(pilotCalls, 70_000, 1_800, "claude-opus-5-5") },
    ...state.agents.map((agent) => ({ sessionId, agentId: agent.id, agentType: agent.name, ...session(agent.endedAt ? 14 : 6, 38_000, 2_400, "claude-sonnet-5-5") })),
  ];
}
