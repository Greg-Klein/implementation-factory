### Write the acceptance criteria registry

Once the answers are in, and before any plan exists, write `.claude/tasks/acceptance-criteria.json`: the one list of what this run has to prove, with an identifier every later document reuses. The planner links its tasks to these identifiers, every evidence file cites them, and the console computes from them which criterion was verified, on which code, and with what. You are its only writer.

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "criteria": [
    {
      "id": "AC1",
      "text": "La valeur du filtre est conservée au retour sur la page.",
      "revision": 1,
      "source": { "kind": "ticket", "reference": "<ticket URL or document URL>", "excerpt": "the sentence it comes from, verbatim" },
      "verification": {
        "expected": "Le filtre retrouve sa dernière valeur.",
        "requiredChecks": [
          { "id": "AC1-C1", "description": "Quitter puis rouvrir la page", "method": "test" }
        ]
      }
    }
  ]
}
```

- **Only what the specification asks.** A criterion comes from the ticket, a reference document (PRD, design, linked issue), an answer the user gave in step 2, or the run instruction: `source.kind` is one of `ticket`, `prd`, `design`, `linked_issue`, `user_answer`, `run_instruction`, and `excerpt` quotes the words it comes from. An obvious behaviour you deduced stays a deduction in `open-questions.md`; it never becomes a requirement here, and neither does a preference the planner infers later.
- **Identifiers are stable for the whole run**, review rounds included: `AC1`, `AC2`, in the order of the ticket. A criterion discovered later gets the next free number; nothing is ever renumbered or reused.
- **A change of meaning is a new revision.** Rewording that changes what has to be true increments the top-level `revision` and sets that criterion's `revision` to it; the console then stops counting the evidence gathered against the older wording. A typo fix is not a change of meaning.
- **A broad criterion is split into required checks** (`AC<n>-C<m>`, `method` one of `test`, `browser`, `static_analysis`, `manual`). It is verified only when every one of them is. A criterion with a single obvious check needs no `requiredChecks`: it is its own check.
- **Nothing that happens after the run is a criterion.** A criterion is something this run can observe before it ends, on the code it delivers: once the implementation and its review are over, nobody is left to verify anything. What the ticket asks to check later (production or ingestion logs, a reading after the release, a review on the deployed app) is written in `open-questions.md` as a follow-up for after the merge, with its source, and listed as such in the review comment and the final report. It gets no id and no evidence. A criterion a local run could observe with an access, a token or data it lacks is not one of those: it stays a criterion, and a blocker of the run.
- **Lint, typecheck and the whole test suite are not criteria.** They stay visible as general checks and are never attached to every criterion to make them look covered.
- **No criterion at all is an answer too**: write `"criteria": []` and say why in `open-questions.md`. The console then shows that nothing was identified instead of an empty "all verified".

Write it the way every evidence file of this run is written, to a temporary name renamed into place (`… > .claude/tasks/acceptance-criteria.json.tmp && mv .claude/tasks/acceptance-criteria.json.tmp .claude/tasks/acceptance-criteria.json`), so the console never reads it half written.
