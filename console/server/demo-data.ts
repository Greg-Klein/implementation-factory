import type { SessionUsage } from "./engine/index.js";
import type { RunState } from "./types.js";
export const demoSelfImprovementDiff = `diff --git a/agents/developer/prompts/system.md b/agents/developer/prompts/system.md
index 3a2f1c8..b7e04d2 100644
--- a/agents/developer/prompts/system.md
+++ b/agents/developer/prompts/system.md
@@ -14,6 +14,9 @@ Tu es l'agent développeur du workflow implementation-harness.
 ## Règles

 - Respecte strictement les critères d'acceptation du ticket.
+- Avant de marquer l'implémentation comme terminée, vérifie que chaque
+  critère d'acceptation a un test unitaire ou d'intégration correspondant.
+- Si un critère n'est pas couvert, crée le test avant de passer à la review.
 - Ne modifie pas les fichiers hors du périmètre défini dans le plan.
 - Signale immédiatement tout blocage ou ambiguïté à l'orchestrateur.

diff --git a/agents/senior-reviewer/prompts/system.md b/agents/senior-reviewer/prompts/system.md
index 9f8c3e1..c14a07f 100644
--- a/agents/senior-reviewer/prompts/system.md
+++ b/agents/senior-reviewer/prompts/system.md
@@ -22,7 +22,12 @@ Tu es le reviewer senior du workflow implementation-harness.
 ## Critères de validation

 - Chaque critère d'acceptation du ticket est couvert par un test.
+- Les cas limites (timezone, locale, permissions) sont explicitement testés.
 - Le code ne contient pas de régression visible dans les tests existants.
 - L'accessibilité est respectée pour tout composant UI.
+
+## Sur les fuseaux horaires
+
+Vérifie systématiquement que les dates et heures affichées tiennent compte
+du fuseau horaire de l'utilisateur. C'est un vecteur de régression fréquent
+identifié dans les runs précédents.
`;

/**
 * What the simulated workflow writes for acceptance coverage: five criteria
 * that end in every state the "Preuves" tab knows (verified, failed, blocked,
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
      "text": "Les préférences sont enregistrées par utilisateur.",
      "revision": 1,
      "source": {
        "kind": "ticket",
        "reference": "ticket-simule://IH-42",
        "excerpt": "Les préférences sont enregistrées par utilisateur."
      },
      "verification": {
        "expected": "Un second compte ne voit pas les réglages du premier."
      }
    },
    {
      "id": "AC2",
      "text": "Les alertes critiques restent affichées quand les notifications sont désactivées, quel que soit le fuseau horaire.",
      "revision": 1,
      "source": {
        "kind": "user_answer",
        "excerpt": "Garder les alertes critiques"
      },
      "verification": {
        "expected": "Alerte critique visible à 23 h en UTC+2.",
        "requiredChecks": [
          {
            "id": "AC2-C1",
            "description": "Alerte visible avec les notifications coupées",
            "method": "browser"
          },
          {
            "id": "AC2-C2",
            "description": "Alerte visible près de minuit dans un autre fuseau",
            "method": "test"
          }
        ]
      }
    },
    {
      "id": "AC3",
      "text": "Le réglage est pris en compte sans rechargement de la page.",
      "revision": 1,
      "source": {
        "kind": "ticket",
        "excerpt": "Le réglage est pris en compte sans rechargement de la page."
      }
    },
    {
      "id": "AC4",
      "text": "Un double clic sur Enregistrer n’envoie qu’une seule requête.",
      "revision": 1,
      "source": {
        "kind": "ticket",
        "excerpt": "Éviter les doubles enregistrements."
      }
    },
    {
      "id": "AC5",
      "text": "Les préférences sont reprises par l’application mobile.",
      "revision": 1,
      "source": {
        "kind": "prd",
        "excerpt": "Réglages partagés entre web et mobile."
      }
    }
  ]
},
  plan: {
  "criteria_revision": 1,
  "summary": "Préférences de notification par utilisateur, alertes critiques conservées.",
  "acceptance_criteria": [
    "AC1: Les préférences sont enregistrées par utilisateur.",
    "AC2: Les alertes critiques restent affichées quand les notifications sont désactivées, quel que soit le fuseau horaire.",
    "AC3: Le réglage est pris en compte sans rechargement de la page.",
    "AC4: Un double clic sur Enregistrer n’envoie qu’une seule requête.",
    "AC5: Les préférences sont reprises par l’application mobile."
  ],
  "tasks": [
    {
      "id": "T1",
      "title": "Ajouter le modèle de préférences",
      "summary": "Enregistre les préférences de notification de chaque compte, avec des valeurs par défaut pour les comptes existants.",
      "description": "Ajouter au profil un objet de préférences de notification (canal, horaires de silence) persisté côté API, avec des valeurs par défaut pour les comptes existants.",
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
      "title": "Créer le panneau de réglages",
      "summary": "Ajoute aux réglages un panneau Notifications où les alertes critiques restent toujours actives.",
      "description": "Créer `NotificationsPanel` dans `src/settings/` : un interrupteur par canal et une plage de silence, lus et écrits par `usePreferences()`.\n\nLes alertes critiques n’ont pas d’interrupteur : le panneau affiche qu’elles restent actives. Le bouton Enregistrer se désactive pendant l’envoi.",
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
      "title": "Connecter l’enregistrement optimiste",
      "summary": "Enregistre chaque réglage dès qu’il change, sans rechargement ni double envoi.",
      "description": "Enregistrer chaque changement immédiatement avec une mise à jour optimiste, annulée si l’API refuse. Un second clic pendant l’envoi ne relance pas de requête.",
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
      "title": "Tester le fallback des alertes critiques",
      "summary": "Vérifie que les alertes critiques restent visibles quand les notifications sont coupées.",
      "description": "Couvrir par des tests l’affichage des alertes critiques quand les notifications sont coupées, y compris autour de minuit dans un autre fuseau.",
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
      "label": "Deux comptes gardent des préférences distinctes",
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
      "expected": "réglages indépendants",
      "actual": "compte B inchangé après modification du compte A"
    },
    {
      "id": "T2-E1",
      "label": "Les alertes critiques restent visibles quand les notifications sont désactivées",
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
      "expected": "alerte critique affichée",
      "actual": "alerte critique affichée",
      "screenshot": "assets/panneau-preferences.png",
      "note": "Route /settings, viewport 1280x900"
    },
    {
      "id": "T3-E1",
      "label": "Le panneau enregistre les préférences sans rechargement",
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
      "actual": "PATCH /api/preferences → 200, état local mis à jour sans reload"
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
      "actual": "0 avertissement"
    },
    {
      "id": "QA-R1-2",
      "label": "Typecheck",
      "verdict": "pass",
      "method": "static_analysis",
      "command": "npm run typecheck",
      "actual": "0 erreur"
    },
    {
      "id": "QA-R1-3",
      "label": "Tests unitaires",
      "verdict": "pass",
      "method": "test",
      "command": "npm run test",
      "actual": "11/11"
    },
    {
      "id": "QA-R1-4",
      "label": "Alerte critique près de minuit en UTC+2",
      "verdict": "fail",
      "criterionIds": [
        "AC2"
      ],
      "checkIds": [
        "AC2-C2"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:20:00.000Z",
      "expected": "alerte affichée",
      "actual": "alerte masquée à 23 h 30",
      "screenshot": "assets/alerte-critique.png"
    },
    {
      "id": "QA-R1-5",
      "label": "Préférences reprises sur mobile",
      "verdict": "unverified",
      "criterionIds": [
        "AC5"
      ],
      "method": "manual",
      "blocker": {
        "reason": "Environnement mobile de recette inaccessible.",
        "action": "Fournir un build mobile de recette relié à cette branche."
      }
    },
    {
      "id": "QA-R1-6",
      "kind": "attempt",
      "label": "Modifier le compte A pendant que le compte B est ouvert",
      "verdict": "pass",
      "criterionIds": [
        "AC1"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:21:00.000Z",
      "expected": "réglages du compte B inchangés",
      "command": "Ouvrir /settings avec les comptes A et B, couper les e-mails sur A, recharger B",
      "actual": "réglages du compte B inchangés"
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
      "actual": "0 avertissement"
    },
    {
      "id": "QA-R2-2",
      "label": "Typecheck",
      "verdict": "pass",
      "method": "static_analysis",
      "command": "npm run typecheck",
      "actual": "0 erreur"
    },
    {
      "id": "QA-R2-3",
      "label": "Tests unitaires",
      "verdict": "pass",
      "method": "test",
      "command": "npm run test",
      "actual": "12/12"
    },
    {
      "id": "QA-R2-4",
      "label": "Alerte critique près de minuit en UTC+2",
      "verdict": "pass",
      "criterionIds": [
        "AC2"
      ],
      "checkIds": [
        "AC2-C2"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:41:00.000Z",
      "expected": "alerte affichée",
      "actual": "alerte affichée à 23 h 30",
      "screenshot": "assets/alerte-critique.png",
      "supersedes": [
        "QA-R1-4"
      ]
    },
    {
      "id": "QA-R2-5",
      "label": "Alerte visible notifications coupées",
      "verdict": "measured",
      "criterionIds": [
        "AC2"
      ],
      "checkIds": [
        "AC2-C1"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:42:00.000Z",
      "expected": "alerte critique affichée",
      "actual": "alerte critique affichée",
      "screenshot": "assets/panneau-preferences.png"
    },
    {
      "id": "QA-R2-6",
      "label": "Deux comptes gardent des préférences distinctes",
      "verdict": "measured",
      "criterionIds": [
        "AC1"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:43:00.000Z",
      "expected": "réglages indépendants",
      "actual": "compte B inchangé"
    },
    {
      "id": "QA-R2-7",
      "kind": "attempt",
      "label": "Double clic sur Enregistrer",
      "verdict": "fail",
      "criterionIds": [
        "AC4"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:44:00.000Z",
      "expected": "1 requête PATCH",
      "command": "Ouvrir /settings, double-cliquer sur Enregistrer, lire l’onglet Réseau",
      "actual": "2 requêtes PATCH observées"
    },
    {
      "id": "QA-R2-8",
      "label": "Préférences reprises sur mobile",
      "verdict": "unverified",
      "criterionIds": [
        "AC5"
      ],
      "method": "manual",
      "supersedes": [
        "QA-R1-5"
      ],
      "blocker": {
        "reason": "Environnement mobile de recette toujours inaccessible.",
        "action": "Fournir un build mobile de recette relié à cette branche."
      }
    },
    {
      "id": "QA-R2-9",
      "label": "Réglage pris en compte sans rechargement",
      "verdict": "confirmed",
      "criterionIds": [
        "AC3"
      ],
      "method": "browser",
      "confirms": "T3-E1",
      "actual": "PATCH /api/preferences → 200 d’après la mesure du développeur, prise avant la reprise"
    },
    {
      "id": "QA-R2-10",
      "kind": "attempt",
      "label": "Changer de compte sans recharger la page",
      "verdict": "pass",
      "criterionIds": [
        "AC1"
      ],
      "method": "browser",
      "observedAt": "2026-09-27T09:45:00.000Z",
      "expected": "réglages du compte B affichés",
      "command": "Ouvrir /settings avec le compte A, se déconnecter, se connecter avec le compte B sans recharger",
      "actual": "réglages du compte B affichés",
      "supersedes": [
        "QA-R1-6"
      ]
    },
    {
      "id": "QA-R2-11",
      "kind": "attempt",
      "label": "Alerte critique à minuit pile en UTC-11",
      "verdict": "pass",
      "criterionIds": [
        "AC2"
      ],
      "checkIds": [
        "AC2-C2"
      ],
      "method": "test",
      "observedAt": "2026-09-27T09:46:00.000Z",
      "expected": "alerte affichée",
      "command": "TZ=Pacific/Pago_Pago npm run test -- critical-alerts",
      "actual": "alerte affichée, 1 test sur 1"
    },
    {
      "id": "QA-R2-12",
      "kind": "attempt",
      "label": "Champ de préférence inconnu envoyé par l’application mobile",
      "verdict": "unverified",
      "criterionIds": [
        "AC5"
      ],
      "method": "static_analysis",
      "expected": "champ inconnu ignoré, réglages connus repris",
      "command": "Lecture de src/settings/preferences-model.ts:41",
      "actual": "le modèle ignore les champs inconnus à la lecture, non exécuté faute de build mobile"
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
        "label": "Espacement vertical entre les interrupteurs du panneau de préférences, 1280 px, repos",
        "verdict": "pass",
        "method": "browser",
        "expected": "16 px (maquette du ticket IH-42)",
        "actual": "16 px",
        "screenshot": "assets/panneau-preferences.png",
        "attachments": [
          "assets/reference-panneau-preferences.png"
        ]
      },
      {
        "id": "DS-R1-2",
        "label": "Anneau de focus clavier de l’interrupteur des notifications par e-mail, 1280 px",
        "verdict": "pass",
        "method": "browser",
        "expected": "anneau visible, contraste d’au moins 3:1 (WCAG 2.4.7 et 1.4.11)",
        "actual": "anneau de 2 px, contraste 4,6:1",
        "screenshot": "assets/panneau-preferences.png"
      },
      {
        "id": "DS-R1-3",
        "label": "Panneau de préférences à 360 px, repos",
        "verdict": "unverified",
        "method": "browser",
        "expected": "interrupteurs empilés sur une colonne (maquette du ticket IH-42)",
        "blocker": {
          "reason": "L’environnement de recette ne sert pas le panneau en dessous de 768 px.",
          "action": "Activer la route /settings sur le gabarit mobile de recette."
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
  "ticket-context.md": `# IH-42 · Préférences de notification

## Objectif
Permettre à chaque utilisateur de choisir les notifications reçues tout en conservant les alertes critiques.

## Critères d’acceptation
- Les préférences sont enregistrées par utilisateur.
- Les alertes critiques restent actives.
- Le réglage est pris en compte sans rechargement de la page.`,
  "implementation-plan.md": `# Plan d’implémentation

1. Ajouter le modèle de préférences.
2. Créer le panneau de réglages.
3. Connecter l’enregistrement optimiste.
4. Ajouter les tests du fallback critique.
5. Vérifier l’accessibilité et les états d’erreur.`,
  "developer-report.md": `# Rapport d’implémentation

- Modèle de préférences ajouté.
- Formulaire connecté au serveur.
- Mise à jour optimiste avec restauration en cas d’échec.
- Tests unitaires ajoutés.

Statut : prêt pour review.`,
  "test-report.json": `{
  "status": "passed",
  "tests": 11,
  "passed": 11,
  "failed": 0
}`,
  "senior-review-round-1.md": `# Review 1/2 · Changements demandés

## Retours
1. Le fallback des alertes critiques ignore le fuseau horaire de l’utilisateur.
2. Aucun test ne couvre ce cas de régression.

Décision : corrections requises avant approbation.`,
  "test-report-round-2.json": `{
  "status": "passed",
  "tests": 12,
  "passed": 12,
  "failed": 0,
  "regressionTest": "critical-alert-timezone"
}`,
  "senior-review-round-2.md": `# Review 2/2 · Bloquée

Les deux retours du premier passage sont résolus :

- le fallback utilise désormais le fuseau horaire de l’utilisateur ;
- un test de régression couvre ce comportement.

Reste ouvert :

- **P0** : AC4 n’est pas tenu, un double clic sur Enregistrer envoie deux requêtes PATCH (\`settings/panel.tsx:88\`).

Limite de deux passages atteinte.

Décision : bloquée. La merge request est ouverte en draft, avec AC4 dans sa section Blocked.`,
  "qa-plan.md": `# Plan de test QA

## Tour 1

### Matrice de comportement

| Critère | Comportement attendu | Observation prévue |
|---|---|---|
| AC1 | Un second compte ne voit pas les réglages du premier | Deux comptes dans deux sessions, modifier A, relire B |
| AC2 | L’alerte critique reste affichée, notifications coupées, quel que soit le fuseau | Couper les notifications, déclencher une alerte à 23 h 30 en UTC+2 |
| AC3 | Le réglage s’applique sans rechargement | Changer un réglage, lire l’onglet Réseau et l’état affiché |
| AC4 | Un double clic n’envoie qu’une requête | Double clic sur Enregistrer, compter les requêtes PATCH |
| AC5 | L’application mobile reprend les préférences | Ouvrir le build mobile de recette après un changement sur le web |

### Grille de risques

- Saisie utilisateur : déclenchée (interrupteurs, bouton Enregistrer).
- Appel réseau : déclenchée (PATCH /api/preferences).
- État persistant : déclenchée (préférences par utilisateur).
- Asynchrone : déclenchée (mise à jour optimiste).
- Données ou migration : déclenchée (nouveau modèle).
- Permissions : déclenchée (isolation entre comptes).
- Sécurité observable : non déclenchée, aucune surface nouvelle exposée.
- Accessibilité : déclenchée (panneau au clavier), couverte par la revue de design.

### Hypothèses de défaut

| Critère | Hypothèse | Déclencheur | Résultat attendu |
|---|---|---|---|
| AC1 | Les réglages sont lus depuis un cache partagé entre sessions | Modifier le compte A pendant que le compte B est ouvert | Réglages du compte B inchangés |
| AC2 | Le fallback compare les dates en UTC | Alerte à 23 h 30 en UTC+2 | Alerte affichée |
| AC3 | L’état local n’est mis à jour qu’au rechargement | Changer un réglage sans recharger | Nouvel état affiché |
| AC4 | Le bouton reste actif pendant l’envoi | Double clic sur Enregistrer | 1 requête PATCH |
| AC5 | Le client mobile rejette un champ qu’il ne connaît pas | Envoyer une préférence ajoutée par le web | Champ ignoré, réglages connus repris |

## Tour 2

### Matrice de comportement

Inchangée. AC2 est à observer de nouveau sur le code repris.

### Hypothèses de défaut

| Critère | Hypothèse | Déclencheur | Résultat attendu |
|---|---|---|---|
| AC1 | L’état du compte précédent reste en mémoire après un changement de compte | Changer de compte sans recharger | Réglages du compte B affichés |
| AC2 | La correction ne tient que pour les fuseaux à l’est de UTC | Alerte à minuit pile en UTC-11 | Alerte affichée |`,
  "qa-report.md": `# Rapport QA

## Verdict

FAIL

AC4 n’est pas tenu : un double clic sur Enregistrer envoie deux requêtes PATCH. AC3 et AC5 restent non vérifiés.

## Contrôles

| Contrôle | Commande exécutée | Résultat | Preuve |
|---|---|---|---|
| Lint | \`npm run lint\` | pass | 0 avertissement |
| Typecheck | \`npm run typecheck\` | pass | 0 erreur |
| Tests unitaires | \`npm run test\` | pass | 12/12 |
| Tests d’intégration | aucune | not run | le projet simulé n’a pas de suite d’intégration |
| Visuel (Playwright) | /settings, 1280x900 | pass | assets/panneau-preferences.png, assets/alerte-critique.png |

## Critères observables

| Critère | Verdict | Valeur lue | Backend | Preuve |
|---|---|---|---|---|
| AC1 | measured live | compte B inchangé | réel | observation en direct, deux sessions |
| AC2 (AC2-C1) | measured live | alerte critique affichée | réel | assets/panneau-preferences.png |
| AC2 (AC2-C2) | measured live | alerte affichée à 23 h 30 | réel | assets/alerte-critique.png |
| AC3 | confirmed from the developer's evidence | PATCH /api/preferences → 200 | réel | T3-E1, prise avant la reprise |
| AC5 | unverified | aucune | réel | build mobile de recette inaccessible |

## Critères d’acceptation

- AC1 : MET, deux comptes gardent des réglages distincts (mesuré en direct).
- AC2 : MET, l’alerte critique reste affichée à 23 h 30 en UTC+2, l’échec du tour 1 est remplacé.
- AC3 : UNVERIFIED, seule la mesure du développeur existe, prise avant la reprise.
- AC4 : NOT MET, un double clic envoie deux requêtes PATCH.
- AC5 : UNVERIFIED, environnement mobile de recette inaccessible.

## Tentatives de mise en échec

| Critère | Hypothèse de défaut | Déclencheur | Attendu | Constaté | Mode |
|---|---|---|---|---|---|
| AC1 | L’état du compte précédent reste en mémoire | Changer de compte sans recharger la page | réglages du compte B affichés | réglages du compte B affichés | exécuté |
| AC2 | La correction ne tient que pour les fuseaux à l’est de UTC | \`TZ=Pacific/Pago_Pago npm run test -- critical-alerts\` | alerte affichée | alerte affichée, 1 test sur 1 | exécuté |
| AC4 | Le bouton reste actif pendant l’envoi | Double clic sur Enregistrer | 1 requête PATCH | 2 requêtes PATCH observées | exécuté |
| AC5 | Le client mobile rejette un champ inconnu | Lecture de \`src/settings/preferences-model.ts:41\` | champ inconnu ignoré | le modèle ignore les champs inconnus à la lecture | lu |

## Problèmes

**P0** : double enregistrement sur double clic

- Exigence violée : critère \`AC4\`, ticket IH-42
- Reproduit ; introduit par le diff
- Étapes pour reproduire : ouvrir /settings, modifier un réglage, double-cliquer sur Enregistrer
- Attendu : 1 requête PATCH
- Constaté : 2 requêtes PATCH (\`settings/panel.tsx:88\`)

## Couverture

- Grille de risques : saisie utilisateur testée (échec sur le double clic) ; appel réseau testé (PATCH observé) ; état persistant testé (AC1) ; asynchrone testé (échec sur AC4) ; données ou migration non testé, pas de base de recette à migrer ; permissions testées (isolation entre comptes) ; sécurité observable non applicable, aucune surface nouvelle ; accessibilité non applicable ici, couverte par la revue de design
- Consommateurs des symboles modifiés : le bandeau d’alertes lit les préférences, contrôle de fumée passé sur /dashboard
- Relances : le test de régression du fuseau a été lancé 3 fois, 3 passages, aucune dépendance à l’ordre constatée
- Scénarios testés : isolation entre comptes, alerte près de minuit dans deux fuseaux, double clic
- Scénarios manquants : AC3 sans tentative exécutée, la mesure en direct n’a pas été refaite après la reprise ; AC5 sans tentative exécutée, build mobile inaccessible

## Rapprochement

- Scénario ajouté après lecture du rapport développeur : contrôle de fumée du bandeau d’alertes.
- Hypothèse abandonnée : aucune.
- Affirmation contredite : le rapport développeur dit l’enregistrement sans double envoi, la tentative sur AC4 montre deux requêtes.
- Risque restant du reviewer senior, fuseau horaire : testé, ligne AC2 des tentatives.

## Non vérifiable

- AC3 : aucune observation en direct sur le code repris. Il faut rejouer le changement de réglage dans le navigateur.
- AC5 : environnement mobile de recette inaccessible. Il faut un build mobile de recette relié à cette branche.`,
  "design-inventory.md": `# Inventaire design

Niveau de référence : ticket-mockup (maquette jointe au ticket IH-42).

| Élément | Source | Viewports | États et contenus | Périmètre |
|---|---|---|---|---|
| Liste des interrupteurs du panneau de préférences | maquette du ticket | 360, 768, 1280 | repos, contenu long | oui |
| Interrupteur des notifications par e-mail | maquette du ticket | 1280 | repos, survol, focus clavier, actif, désactivé | oui |
| Bouton Enregistrer | maquette du ticket | 1280 | repos, focus clavier, chargement | oui |
| Bandeau d’alerte critique | écran voisin /dashboard | 1280 | repos | non |`,
  "designer-review.md": `# Revue de design

## Résumé

- Niveau de référence : ticket-mockup, la maquette jointe au ticket IH-42
- Évaluation globale : le panneau suit la maquette à 1280 px, la largeur mobile n’a pas pu être atteinte

## Méthode d'inspection

- Référence : lue en entier
- App en direct : inspectée via Playwright
- Recette : fournie
- Thème sombre et mouvement réduit : non pris en charge
- Routes consommatrices : non demandées
- Niveau de confiance : moyen

## Matrice de couverture

| Écran | Viewport | État ou contenu | Couverture | Captures (référence, live) | Obstacle |
| --- | --- | --- | --- | --- | --- |
| Panneau de préférences | 1280 | repos | mesuré | assets/reference-panneau-preferences.png, assets/panneau-preferences.png | |
| Panneau de préférences | 1280 | focus clavier | mesuré | assets/panneau-preferences.png | invariant, sans capture de référence |
| Panneau de préférences | 360 | repos | non atteint | | la recette ne sert pas le panneau en dessous de 768 px |

- Lignes d'inventaire dans le périmètre : 3, dont mesurées : 2 (67 %)

## Matrice des états

| Élément | Repos | Survol | Focus clavier | Actif | Désactivé | Chargement | Vide | Erreur |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Interrupteur des notifications par e-mail | conforme | non atteint | conforme | non atteint | non atteint | sans objet | sans objet | sans objet |
| Bouton Enregistrer | conforme | non atteint | non atteint | non atteint | sans objet | non atteint | sans objet | sans objet |

## Accessibilité

| Contrôle | Élément | Seuil | Mesuré | Résultat |
| --- | --- | --- | --- | --- |
| focus visible | Interrupteur des notifications par e-mail | contraste 3:1 (WCAG 1.4.11) | 4,6:1 | conforme |

## Écarts avec les mesures du développeur

- Éléments, états ou viewports de l'inventaire que le développeur n'a pas mesurés : 360 px, focus clavier
- Mesurés par le développeur et absents de l'inventaire : aucun
- Valeurs en désaccord : aucune

## Problèmes bloquants (P0)

Aucun

## Problèmes importants (P1)

Aucun

## Problèmes mineurs (P2)

Aucun

## Écarts préexistants (éléments que le ticket ne touche pas)

Aucun

## Conflits à arbitrer

Aucun

## À vérifier par la QA

- Double-cliquer sur Enregistrer : le bouton ne passe pas à l’état chargement entre les deux clics, observé à 1280 px. Indice de l’état de l’app : deux lignes PATCH dans l’onglet Réseau.

## Observations sans référence

Aucun

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
  "developer-report-T1.md": "# T1 · Modèle de préférences\n\nModèle et migration ajoutés, 3 tests.",
  "developer-report-T2.md": "# T2 · Panneau de réglages\n\nPanneau accessible au clavier, 4 tests.",
  "developer-report-T3.md": "# T3 · Enregistrement optimiste\n\nMise à jour optimiste avec retour arrière en cas d’erreur, 3 tests.",
  "developer-report-T4.md": "# T4 · Fallback des alertes critiques\n\nFuseau horaire pris en compte, test de régression ajouté.",
  "mr-description.md": `# Draft: IH-42 · Ajouter les préférences de notification

## Blocked
- AC4 : un double clic sur Enregistrer envoie deux requêtes PATCH. Toujours en échec après les deux passages de review.
- AC5 : bloqué, l’environnement mobile de recette était inaccessible.

## Changements
- Ajout du panneau de préférences.
- Enregistrement optimiste des réglages.
- Conservation des alertes critiques.
- Prise en compte des retours de review sur le fuseau horaire.

## Validation
- 12 tests passent.
- 2 critères vérifiés sur 5 : AC1 et AC2. AC3 reste non vérifié, sa seule mesure date d’avant la reprise.
- Review senior bloquée au second passage sur AC4.`,
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
    ...state.agents.map((agent) => ({ sessionId, agentId: agent.id, agentType: agent.name, ...session(agent.endedAt ? 14 : 6, 38_000, 2_400, agent.name.includes("developer") ? "claude-opus-5-5" : "claude-sonnet-5-5") })),
  ];
}
