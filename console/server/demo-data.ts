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
  "senior-review-round-2.md": `# Review 2/2 · Approuvée

Les deux retours du premier passage sont résolus :

- le fallback utilise désormais le fuseau horaire de l’utilisateur ;
- un test de régression couvre ce comportement.

Décision : approuvé.`,
  "qa-report.md": `# QA Report

## Verdict

PASS

## Gates

| Contrôle | Commande | Résultat | Preuve |
|---|---|---|---|
| Lint | \`npm run lint\` | pass | 0 avertissement |
| Typecheck | \`npm run typecheck\` | pass | 0 erreur |
| Tests unitaires | \`npm run test\` | pass | 12/12 |
| Accessibilité | axe sur le panneau | pass | 0 violation |

## Critères d’acceptation

- AC1 — MET : le panneau enregistre les préférences (\`settings/panel.tsx:64\`).
- AC2 — MET : les alertes critiques restent actives (\`settings/panel.tsx:112\`).

## Issues

Aucune.`,
  "dev-evidence.json": `{
  "source": "developer",
  "items": [
    { "label": "Le panneau enregistre les préférences sans rechargement", "verdict": "measured", "actual": "PATCH /api/preferences → 200, état local mis à jour sans reload" },
    { "label": "Les alertes critiques restent visibles quand les notifications sont désactivées", "verdict": "measured", "expected": "alerte critique affichée", "actual": "alerte critique affichée", "screenshot": "assets/panneau-preferences.png", "note": "Route /settings, viewport 1280x900" }
  ]
}`,
  "assets/panneau-preferences.png": "iVBORw0KGgoAAAANSUhEUgAAAPAAAACWCAIAAABvmpKCAAABhUlEQVR42u3bsQkAIAxFQee0dghXFizcQFsHMCB6jz9BuDZpSg+VnEBAS0BLQEtAC2gJaAloCWgJaAEtAS0BLQEtAS2gJaAloCWgpRDQuRaz4wPagAbagAbagDYD2oAG2oAG2oAG2oA2A9qABtqABtqABtqANgPagAbagAbagDYD2uw+0JKvbwloCWgBLQEtAS0BLQEtoCWgJaAloCWgBbQEtAS0BLQEtICW/gDdRzM7PqANaKANaKANaDOgDWigDWigDWigDWgzoA1ooA1ooA1ooA1oM6ANaKANaKANaDOgzYA2oIE2oIE2oM2ANgPagAbagAbagDYD2gxoAxpoAxpoA9oMaDOgDWigDWigDWgzoA1ooA1ooA1ooA1oM6ANaKANaKANaKANaDOgDWigDWigDWjXN6DNgDaggTaggTagzYA2A9qAjgMt3RbQAloCWgJaAlpAS0BLQEtAS0ALaAloCWgJaAloAS0BLQEtAS0BLaAloCWgJaAloAW0BLQEtAS0tLUAbBdKI9fqZY4AAAAASUVORK5CYII=",
  "qa-evidence.json": `{
  "source": "qa",
  "status": "PASS",
  "items": [
    { "label": "Lint", "verdict": "pass", "command": "npm run lint", "actual": "0 avertissement" },
    { "label": "Typecheck", "verdict": "pass", "command": "npm run typecheck", "actual": "0 erreur" },
    { "label": "Tests unitaires", "verdict": "pass", "command": "npm run test", "actual": "12/12" },
    { "label": "Accessibilité du panneau de préférences", "verdict": "pass", "command": "axe sur le panneau", "actual": "0 violation" }
  ]
}`,
  "planner-output.json": JSON.stringify({
    summary: "Préférences de notification par utilisateur, alertes critiques conservées.",
    tasks: [
      { id: "T1", title: "Ajouter le modèle de préférences", complexity: "S" },
      { id: "T2", title: "Créer le panneau de réglages", complexity: "M" },
      { id: "T3", title: "Connecter l’enregistrement optimiste", complexity: "M" },
      { id: "T4", title: "Tester le fallback des alertes critiques", complexity: "S" },
    ],
  }, null, 2),
  "developer-report-T1.md": "# T1 · Modèle de préférences\n\nModèle et migration ajoutés, 3 tests.",
  "developer-report-T2.md": "# T2 · Panneau de réglages\n\nPanneau accessible au clavier, 4 tests.",
  "developer-report-T3.md": "# T3 · Enregistrement optimiste\n\nMise à jour optimiste avec retour arrière en cas d’erreur, 3 tests.",
  "developer-report-T4.md": "# T4 · Fallback des alertes critiques\n\nFuseau horaire pris en compte, test de régression ajouté.",
  "mr-description.md": `# IH-42 · Ajouter les préférences de notification

## Changements
- Ajout du panneau de préférences.
- Enregistrement optimiste des réglages.
- Conservation des alertes critiques.
- Prise en compte des retours de review sur le fuseau horaire.

## Validation
- 12 tests passent.
- Review senior approuvée au second passage.
- QA validée.`,
};

