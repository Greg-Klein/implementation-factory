# Schedule input and output

The console asks, for one repository, which tickets of a batch can be implemented at the same time. It writes the input file, runs `/implementation-harness:schedule <input-path> <output-path>` from the repository's main checkout, and reads the output file once the session has ended. Both paths are absolute and sit outside the repository. The output file is the only thing the session writes.

Every example below is invented. Never copy the content of a real ticket into this file or into any tracked file.

## Language

`summary` and `reason` are written in French, with `implementation-harness:unslop`. The console shows `reason` to the user in the queue. Field names, enum values, paths and `issue_url` values stay exactly as specified: the console reads them as data.

---

## Input (written by the console)

```json
{
  "repository": "/abs/path/to/checkout",
  "tickets": [
    { "issue_url": "https://gitlab.com/acme/shop/-/issues/101" },
    { "issue_url": "https://gitlab.com/acme/shop/-/issues/102" },
    { "issue_url": "https://gitlab.com/acme/shop/-/issues/103" }
  ],
  "known": [
    {
      "issue_url": "https://gitlab.com/acme/shop/-/issues/98",
      "areas": ["src/checkout"],
      "files": ["src/checkout/cart-summary.tsx", "src/checkout/cart-summary.test.tsx"],
      "state": "running"
    }
  ]
}
```

- `repository`: absolute path of the main checkout, the directory the session runs in.
- `tickets`: the tickets to predict: the new ones, and those of the repository whose earlier analysis failed. An empty array is valid and gives an output with two empty arrays.
- `known`: earlier predictions for tickets of the same repository that are `queued`, `running` or `awaiting_merge`. They are compared against, never recomputed and never repeated in the output `tickets`. May be empty or absent.

## Output (STRICT JSON)

```json
{
  "tickets": [
    {
      "issue_url": "https://gitlab.com/acme/shop/-/issues/101",
      "areas": ["src/checkout"],
      "files": ["src/checkout/cart-summary.tsx", "src/checkout/promo-code.ts"],
      "confidence": "high",
      "summary": "Ajoute la saisie d'un code promo dans le récapitulatif du panier."
    },
    {
      "issue_url": "https://gitlab.com/acme/shop/-/issues/102",
      "areas": ["src/checkout"],
      "files": ["src/checkout/promo-code.ts", "src/emails/order-confirmation.tsx"],
      "confidence": "medium",
      "summary": "Affiche la remise du code promo dans l'e-mail de confirmation de commande."
    },
    {
      "issue_url": "https://gitlab.com/acme/shop/-/issues/103",
      "areas": [],
      "files": [],
      "confidence": "low",
      "summary": "Demande d'améliorer les performances, sans écran ni mesure cités."
    }
  ],
  "edges": [
    {
      "a": "https://gitlab.com/acme/shop/-/issues/101",
      "b": "https://gitlab.com/acme/shop/-/issues/98",
      "kind": "overlap",
      "reason": "Les deux tickets modifient le récapitulatif du panier."
    },
    {
      "a": "https://gitlab.com/acme/shop/-/issues/101",
      "b": "https://gitlab.com/acme/shop/-/issues/102",
      "kind": "depends_on",
      "order": [
        "https://gitlab.com/acme/shop/-/issues/101",
        "https://gitlab.com/acme/shop/-/issues/102"
      ],
      "reason": "L'e-mail affiche la remise que le premier ticket calcule."
    }
  ]
}
```

### `tickets[]`

One entry per ticket of the input `tickets`, in the same order, and no other.

- `issue_url`: copied character for character from the input. It is the key the console joins on.
- `files`: paths the ticket is expected to modify or create, relative to the repository root, tests included. A file that does not exist yet is given at the path the repository's conventions put it.
- `areas`: directories, relative to the repository root and without a trailing slash, where the change lands when the exact files cannot be named. Use the narrowest directory that holds the change. Do not list the parent directory of a file already in `files` unless other, unnamed files of that directory are expected to change too.
- `confidence`:
  - `high`: the ticket names the behavior and the code that carries it was found, so `files` is close to the real diff.
  - `medium`: the surface was found but part of the change is a guess (a new file, a refactor of unknown width).
  - `low`: the ticket is too vague, could not be read, or nothing in the repository matches it. `files` and `areas` may be empty. The console treats a `low` ticket as conflicting with every ticket of the repository, so it runs alone. `low` is a statement about this ticket, never a default.
- `summary`: one French sentence, 200 characters at most, saying what the ticket changes. For a `low` ticket it says what is missing.

### `edges[]`

An edge links two tickets that must not run in parallel, or must run in a given order. `a` and `b` are `issue_url` values; at least one of them is a new ticket, the other is a new ticket or a `known` one.

- `kind: "overlap"`: the two predictions share at least one file, or one narrow area. The two tickets can run in either order but not at the same time. No `order` field.
- `kind: "depends_on"`: one ticket needs the result of the other, because GitLab links them with "blocks" / "is blocked by" or because the text of one says so. `order` is required: `[first, second]`, where `first` is implemented before `second`, and the two values are `a` and `b`.
- `reason`: one short French sentence naming what is shared or what is needed. It never quotes the ticket at length.

At most one edge per pair of tickets. When a pair both overlaps and depends, write the `depends_on` edge alone: it already keeps the two apart.

Two tickets that merely sit in the same large module get no edge. An edge needs a shared file, a shared directory small enough that two diffs in it are likely to touch the same lines, or a stated dependency.

## Validation applied by the console

The console rejects the whole file when one of these fails:

- the file is missing, is not valid JSON, or lacks one of the two arrays;
- a `tickets[].issue_url` is not in the input `tickets` (unknown issue_url), an input ticket has no entry, or one appears twice;
- `confidence` or `kind` holds a value outside the enums above;
- an edge names an `issue_url` that is neither in the input `tickets` nor in `known` (unknown issue_url), or links two `known` tickets;
- an edge has `a` equal to `b` (self edge);
- a `depends_on` edge has no `order`, or an `order` that is not exactly `a` and `b`, in either sequence (missing order); an `overlap` edge carries an `order`;
- two edges link the same pair of tickets, whatever their kind and whichever is `a` (duplicate edge);
- a `reason` or a `summary` is empty.

## Quality self-check (MANDATORY)

Before writing the file, validate:

- every rule of the validation list above holds
- every `overlap` edge can be justified by naming the shared file or directory from the two predictions
- every `depends_on` edge points at a GitLab link or a sentence of the ticket, not at a guess about a sensible order
- no `known` prediction was changed or repeated
- each `low` is there because the ticket gives nothing to search for, and each `high` because the code was actually read
