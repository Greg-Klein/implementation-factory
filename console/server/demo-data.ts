import type { SessionUsage } from "./engine/index.js";
import type { RunState } from "./types.js";
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

export const demoAcceptance = {
  criteria: {
  "schemaVersion": 1,
  "revision": 1,
  "criteria": [
    {
      "id": "AC1",
      "text": "Preferences are saved per user.",
      "revision": 1,
      "source": {
        "kind": "ticket",
        "reference": "ticket-simule://IH-42",
        "excerpt": "Preferences are saved per user."
      },
      "verification": {
        "expected": "A second account does not see the first one's settings."
      }
    },
    {
      "id": "AC2",
      "text": "Critical alerts stay displayed when notifications are turned off, whatever the time zone.",
      "revision": 1,
      "source": {
        "kind": "user_answer",
        "excerpt": "Keep critical alerts"
      },
      "verification": {
        "expected": "Critical alert visible at 11 pm in UTC+2.",
        "requiredChecks": [
          {
            "id": "AC2-C1",
            "description": "Alert visible with notifications turned off",
            "method": "browser"
          },
          {
            "id": "AC2-C2",
            "description": "Alert visible near midnight in another time zone",
            "method": "test"
          }
        ]
      }
    },
    {
      "id": "AC3",
      "text": "The setting takes effect without reloading the page.",
      "revision": 1,
      "source": {
        "kind": "ticket",
        "excerpt": "The setting takes effect without reloading the page."
      }
    },
    {
      "id": "AC4",
      "text": "A double click on Save sends only one request.",
      "revision": 1,
      "source": {
        "kind": "ticket",
        "excerpt": "Avoid double saves."
      }
    },
    {
      "id": "AC5",
      "text": "Preferences are picked up by the mobile app.",
      "revision": 1,
      "source": {
        "kind": "prd",
        "excerpt": "Settings shared between web and mobile."
      }
    }
  ]
},
  plan: {
  "criteria_revision": 1,
  "summary": "Per-user notification preferences, critical alerts kept.",
  "acceptance_criteria": [
    "AC1: Preferences are saved per user.",
    "AC2: Critical alerts stay displayed when notifications are turned off, whatever the time zone.",
    "AC3: The setting takes effect without reloading the page.",
    "AC4: A double click on Save sends only one request.",
    "AC5: Preferences are picked up by the mobile app."
  ],
  "tasks": [
    {
      "id": "T1",
      "title": "Add the preferences model",
      "summary": "Saves each account's notification preferences, with default values for existing accounts.",
      "description": "Add a notification preferences object (channel, quiet hours) to the profile, persisted on the API side, with default values for existing accounts.",
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
      "title": "Create the settings panel",
      "summary": "Adds a Notifications panel to the settings where critical alerts always stay on.",
      "description": "Create `NotificationsPanel` in `src/settings/`: one toggle per channel and a quiet range, read and written by `usePreferences()`.\n\nCritical alerts have no toggle: the panel says they stay on. The Save button is disabled while the request is being sent.",
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
      "title": "Wire up optimistic saving",
      "summary": "Saves each setting as soon as it changes, with no reload and no double send.",
      "description": "Save each change immediately with an optimistic update, rolled back if the API refuses. A second click while the request is being sent does not start another one.",
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
      "title": "Test the critical alerts fallback",
      "summary": "Checks that critical alerts stay visible when notifications are turned off.",
      "description": "Cover with tests the display of critical alerts when notifications are turned off, including around midnight in another time zone.",
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
      "label": "Two accounts keep separate preferences",
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
      "expected": "independent settings",
      "actual": "account B unchanged after changing account A"
    },
    {
      "id": "T2-E1",
      "label": "Critical alerts stay visible when notifications are turned off",
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
      "expected": "critical alert displayed",
      "actual": "critical alert displayed",
      "screenshot": "assets/panneau-preferences.png",
      "note": "Route /settings, viewport 1280x900"
    },
    {
      "id": "T3-E1",
      "label": "The panel saves preferences without a reload",
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
      "actual": "PATCH /api/preferences → 200, local state updated without a reload"
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
      "actual": "0 warnings"
    },
    {
      "id": "QA-R1-2",
      "label": "Typecheck",
      "verdict": "pass",
      "method": "static_analysis",
      "command": "npm run typecheck",
      "actual": "0 errors"
    },
    {
      "id": "QA-R1-3",
      "label": "Unit tests",
      "verdict": "pass",
      "method": "test",
      "command": "npm run test",
      "actual": "11/11"
    },
    {
      "id": "QA-R1-4",
      "label": "Critical alert near midnight in UTC+2",
      "verdict": "fail",
      "criterionIds": [
        "AC2"
      ],
      "checkIds": [
        "AC2-C2"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:20:00.000Z",
      "expected": "alert displayed",
      "actual": "alert hidden at 11:30 pm",
      "screenshot": "assets/alerte-critique.png"
    },
    {
      "id": "QA-R1-5",
      "label": "Preferences picked up on mobile",
      "verdict": "unverified",
      "criterionIds": [
        "AC5"
      ],
      "method": "manual",
      "blocker": {
        "reason": "Mobile staging environment unreachable.",
        "action": "Provide a mobile staging build linked to this branch."
      }
    },
    {
      "id": "QA-R1-6",
      "kind": "attempt",
      "label": "Change account A while account B is open",
      "verdict": "pass",
      "criterionIds": [
        "AC1"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:21:00.000Z",
      "expected": "account B settings unchanged",
      "command": "Open /settings with accounts A and B, turn off emails on A, reload B",
      "actual": "account B settings unchanged"
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
      "actual": "0 warnings"
    },
    {
      "id": "QA-R2-2",
      "label": "Typecheck",
      "verdict": "pass",
      "method": "static_analysis",
      "command": "npm run typecheck",
      "actual": "0 errors"
    },
    {
      "id": "QA-R2-3",
      "label": "Unit tests",
      "verdict": "pass",
      "method": "test",
      "command": "npm run test",
      "actual": "12/12"
    },
    {
      "id": "QA-R2-4",
      "label": "Critical alert near midnight in UTC+2",
      "verdict": "pass",
      "criterionIds": [
        "AC2"
      ],
      "checkIds": [
        "AC2-C2"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:41:00.000Z",
      "expected": "alert displayed",
      "actual": "alert displayed at 11:30 pm",
      "screenshot": "assets/alerte-critique.png",
      "supersedes": [
        "QA-R1-4"
      ]
    },
    {
      "id": "QA-R2-5",
      "label": "Alert visible with notifications off",
      "verdict": "measured",
      "criterionIds": [
        "AC2"
      ],
      "checkIds": [
        "AC2-C1"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:42:00.000Z",
      "expected": "critical alert displayed",
      "actual": "critical alert displayed",
      "screenshot": "assets/panneau-preferences.png"
    },
    {
      "id": "QA-R2-6",
      "label": "Two accounts keep separate preferences",
      "verdict": "measured",
      "criterionIds": [
        "AC1"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:43:00.000Z",
      "expected": "independent settings",
      "actual": "account B unchanged"
    },
    {
      "id": "QA-R2-7",
      "kind": "attempt",
      "label": "Double click on Save",
      "verdict": "fail",
      "criterionIds": [
        "AC4"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:44:00.000Z",
      "expected": "1 PATCH request",
      "command": "Open /settings, double-click Save, read the Network tab",
      "actual": "2 PATCH requests observed"
    },
    {
      "id": "QA-R2-8",
      "label": "Preferences picked up on mobile",
      "verdict": "unverified",
      "criterionIds": [
        "AC5"
      ],
      "method": "manual",
      "supersedes": [
        "QA-R1-5"
      ],
      "blocker": {
        "reason": "Mobile staging environment still unreachable.",
        "action": "Provide a mobile staging build linked to this branch."
      }
    },
    {
      "id": "QA-R2-9",
      "label": "Setting takes effect without a reload",
      "verdict": "confirmed",
      "criterionIds": [
        "AC3"
      ],
      "method": "browser",
      "confirms": "T3-E1",
      "actual": "PATCH /api/preferences → 200 according to the developer's measurement, taken before the rework"
    },
    {
      "id": "QA-R2-10",
      "kind": "attempt",
      "label": "Switch accounts without reloading the page",
      "verdict": "pass",
      "criterionIds": [
        "AC1"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:45:00.000Z",
      "expected": "account B settings displayed",
      "command": "Open /settings with account A, log out, log in with account B without reloading",
      "actual": "account B settings displayed",
      "supersedes": [
        "QA-R1-6"
      ]
    },
    {
      "id": "QA-R2-11",
      "kind": "attempt",
      "label": "Critical alert at midnight sharp in UTC-11",
      "verdict": "pass",
      "criterionIds": [
        "AC2"
      ],
      "checkIds": [
        "AC2-C2"
      ],
      "method": "test",
      "observedAt": "2026-09-27T09:46:00.000Z",
      "expected": "alert displayed",
      "command": "TZ=Pacific/Pago_Pago npm run test -- critical-alerts",
      "actual": "alert displayed, 1 test out of 1"
    },
    {
      "id": "QA-R2-12",
      "kind": "attempt",
      "label": "Unknown preference field sent by the mobile app",
      "verdict": "unverified",
      "criterionIds": [
        "AC5"
      ],
      "method": "static_analysis",
      "expected": "unknown field ignored, known settings picked up",
      "command": "Reading src/settings/preferences-model.ts:41",
      "actual": "the model ignores unknown fields on read, not executed for lack of a mobile build"
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
        "label": "Vertical spacing between the toggles of the preferences panel, 1280 px, rest",
        "verdict": "pass",
        "method": "browser",
        "expected": "16 px (mockup of ticket IH-42)",
        "actual": "16 px",
        "screenshot": "assets/panneau-preferences.png",
        "attachments": [
          "assets/reference-panneau-preferences.png"
        ]
      },
      {
        "id": "DS-R1-2",
        "label": "Keyboard focus ring of the email notifications toggle, 1280 px",
        "verdict": "pass",
        "method": "browser",
        "expected": "visible ring, contrast of at least 3:1 (WCAG 2.4.7 and 1.4.11)",
        "actual": "2 px ring, contrast 4.6:1",
        "screenshot": "assets/panneau-preferences.png"
      },
      {
        "id": "DS-R1-3",
        "label": "Preferences panel at 360 px, rest",
        "verdict": "unverified",
        "method": "browser",
        "expected": "toggles stacked in one column (mockup of ticket IH-42)",
        "blocker": {
          "reason": "The staging environment does not serve the panel below 768 px.",
          "action": "Enable the /settings route on the mobile staging template."
        }
      }
    ]
  },
  captures: {
    roundOne: "iVBORw0KGgoAAAANSUhEUgAAAPAAAACWCAIAAABvmpKCAAABq0lEQVR42u3cQQqAIBBA0Q4iRDcM2nS1ThVYEBREexe1E9MH7wT6VzNit+0rVKNzBAgaBA2CBkEjaBA0CBoEDYJG0CBoEDQIGgSNoF+c1wHZCBpBCxpBg6BB0Aha0Aha0AgaBA2CRtCCRtCCRtBQb9Bh6OGToBG0oBG0oBG0oBE0ghY0ghY0ghY0ghY0tQUN3nKAoBG0oBG0oBE0CBoEjaAFjaAFjaBB0FBO0OM8kY2gBS1oQQta0IJG0IJG0IIWtKCN7RC0oBE0CBoEjaAFjaBB0GCxQttLGUEjaEELWtCCFrSgEbSgEbSxHcZ2gkbQIGgQNIIWNIIWNIIGQYOgEbSgEbSgETQIGgSNoAWNoAWNoKGmoJcQEneMkBA0ghY0ghY0ghY0gkbQgkbQgkbQgkbQgkbQCFrQCFrQCFrQCFrQCBpBCxpBCxpBCxpBCxpBI2hBI2hBI2hBI2iXh6ARtKARtKARNPh9FASNoAWNoAWNoEHQIGgELWgELWgEDYIGQSNoQSNoQSNo+FvQUDJBI2gQNAgaBI2gQdAgaBA0CBpBg6BB0CBoEDRNeQBcUPVx86/LeAAAAABJRU5ErkJggg==",
    reference: "iVBORw0KGgoAAAANSUhEUgAAAPAAAACWCAIAAABvmpKCAAABhUlEQVR42u3bsQkAIAxFQee0dghXFizcQFsHMCB6jz9BuDZpSg+VnEBAS0BLQEtAC2gJaAloCWgJaAEtAS0BLQEtAS2gJaAloCWgpRDQuRaz4wPagAbagAbagDYD2oAG2oAG2oAG2oA2A9qABtqABtqABtqANgPagAbagAbagDYD2uw+0JKvbwloCWgBLQEtAS0BLQEtoCWgJaAloCWgBbQEtAS0BLQEtICW/gDdRzM7PqANaKANaKANaDOgDWigDWigDWigDWgzoA1ooA1ooA1ooA1oM6ANaKANaKANaDOgzYA2oIE2oIE2oM2ANgPagAbagAbagDYD2gxoAxpoAxpoA9oMaDOgDWigDWigDWgzoA1ooA1ooA1ooA1oM6ANaKANaKANaKANaDOgDWigDWigDWjXN6DNgDaggTaggTagzYA2A9qAjgMt3RbQAloCWgJaAlpAS0BLQEtAS0ALaAloCWgJaAloAS0BLQEtAS0BLaAloCWgJaAloAW0BLQEtAS0tLUAbBdKI9fqZY4AAAAASUVORK5CYII=",
    roundTwo: "iVBORw0KGgoAAAANSUhEUgAAAPAAAACWCAIAAABvmpKCAAABrklEQVR42u3csQmAMBBAUVt3EMSZXESwcTC3srBQEEyhfQrtRM8Hb4LkV3chxbLOEEbhCBA0CBoEDYJG0CBoEDQIGgSNoEHQIGgQNAgaQV/Y0waPETSCFjSCBkGDoBG0oBG0oBE0CBoEjaAFjaAFjaAhbtBVU8MtQSNoQSNoQSNoQSNoBC1oBC1oBC1oBC1oogUN3nKAoBG0oBG0oBE0CBoEjaAFjaAFjaBB0PCeoLuh5zGCFrSgBS1oQQsaQQsaQQta0II2tkPQgkbQIGgQNIIWNIIGQYPFCv9eyggaQQta0IIWtKAFjaAFjaCN7TC2EzSCBkGDoBG0oBG0oBE0CBoEjaAFjaAFjaBB0CBoBC1oBC1oBA2Rgh7bMnOkCTKCRtCCRtCCRtCCRtAIWtAIWtAIWtAIWtAIGkELGkELGkELGkELGkEjaEEjaEEjaEEjaEEjaAQtaAQtaAQtaATt8hA0ghY0ghY0gga/j4KgEbSgEbSgETQIGgSNoAWNoAWNoEHQIGgELWgELWgEDV8LGt5M0AgaBA2CBkEjaBA0CBoEDYJG0CBoEDQIGgTNr5zw8ERAS6cq7QAAAABJRU5ErkJggg==",
  },
};

export const demoArtifactContents: Record<string, string> = {
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
  "test-report.json": `{
  "status": "passed",
  "tests": 11,
  "passed": 11,
  "failed": 0
}`,
  "senior-review-round-1.md": `# Review 1/2 · Changes requested

## Findings
1. The critical alerts fallback ignores the user's time zone.
2. No test covers this regression case.

Decision: fixes required before approval.`,
  "test-report-round-2.json": `{
  "status": "passed",
  "tests": 12,
  "passed": 12,
  "failed": 0,
  "regressionTest": "critical-alert-timezone"
}`,
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
  "dev-evidence.json": JSON.stringify(demoAcceptance.developer, null, 2),
  "assets/panneau-preferences.png": "iVBORw0KGgoAAAANSUhEUgAAAPAAAACWCAIAAABvmpKCAAABhUlEQVR42u3bsQkAIAxFQee0dghXFizcQFsHMCB6jz9BuDZpSg+VnEBAS0BLQEtAC2gJaAloCWgJaAEtAS0BLQEtAS2gJaAloCWgpRDQuRaz4wPagAbagAbagDYD2oAG2oAG2oAG2oA2A9qABtqABtqABtqANgPagAbagAbagDYD2uw+0JKvbwloCWgBLQEtAS0BLQEtoCWgJaAloCWgBbQEtAS0BLQEtICW/gDdRzM7PqANaKANaKANaDOgDWigDWigDWigDWgzoA1ooA1ooA1ooA1oM6ANaKANaKANaDOgzYA2oIE2oIE2oM2ANgPagAbagAbagDYD2gxoAxpoAxpoA9oMaDOgDWigDWigDWgzoA1ooA1ooA1ooA1oM6ANaKANaKANaKANaDOgDWigDWigDWjXN6DNgDaggTaggTagzYA2A9qAjgMt3RbQAloCWgJaAlpAS0BLQEtAS0ALaAloCWgJaAloAS0BLQEtAS0BLaAloCWgJaAloAW0BLQEtAS0tLUAbBdKI9fqZY4AAAAASUVORK5CYII=",
  "qa-evidence.json": JSON.stringify(demoAcceptance.qaRoundTwo, null, 2),
  "qa-evidence-round1.json": JSON.stringify(demoAcceptance.qaRoundOne, null, 2),
  "acceptance-criteria.json": JSON.stringify(demoAcceptance.criteria, null, 2),
  "assets/alerte-critique.png": demoAcceptance.captures.roundTwo,
  "assets/reference-panneau-preferences.png": demoAcceptance.captures.reference,
  "design-evidence.json": JSON.stringify(demoAcceptance.design, null, 2),
  "planner-output.json": JSON.stringify(demoAcceptance.plan, null, 2),
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
