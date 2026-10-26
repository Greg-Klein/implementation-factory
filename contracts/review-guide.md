# Review guide

A repository's owners may say what a review of that repository should weigh, what it should skip, and where it should stop nitpicking. They write it themselves. This workflow does not invent one.

## Where it lives

The first of these files that exists, relative to the run worktree:

1. `REVIEW.md`
2. `.claude/REVIEW.md`
3. `docs/REVIEW.md`

One file, not a merge of several. No file: the review is unchanged, and no report mentions the absence.

At the start of a run the console copies that file to `.claude/tasks/review-guide.md`. The first line is `<!-- source: REVIEW.md -->` (or whichever candidate it copied) and is the console's note, not the owner's text. The rest is the file. The copy is dated before the run, so it is not a document of the run. `IMPL_REVIEW_GUIDE` names the source path when a copy was made, and is absent otherwise.

## Who reads it

`senior-reviewer`, `qa-reviewer` and `designer-reviewer` read `.claude/tasks/review-guide.md` when it exists, whether or not the caller named it. The designer may read that file and no other product file: the copy is a task file, not product source. The review orchestrator passes the path to each reviewer and does not apply the guide itself. A developer is not given it. The guide adds no requirement and widens no scope.

Read it as the repository's review policy, not as a claim about this change. Expectations still come from the specification and the code. The guide steers attention and filters findings after that.

## What it changes

Apply the whole file. Three parts have a mechanical effect when the owner wrote them under these headings (English or French):

| Heading | Effect |
| --- | --- |
| `## Priorities`, `## Priorités` | Spend the review on the failure modes named there. A priority is not a new requirement. A correctness defect outside them is still a finding. |
| `## Ignored paths`, `## Paths to ignore`, `## Chemins ignorés` | Each bullet is a path or a glob, the first token, taken from the repository root. Do not file a finding whose only file matches. |
| `## Nitpick limits`, `## Limite des détails` | Drop findings the text calls nits, style, formatting, naming or comments, past the cap it sets. |

**Globs.** `**` crosses directories, `*` stays inside one segment. A pattern that contains a slash is matched from the repository root (`generated/**` ignores `generated/out.ts`, not `src/generated/out.ts`). A pattern without a slash matches that name at any depth. A directory is written `dir/**`.

**Nits.** A broken behaviour, a security finding, an unmet acceptance criterion, and any P0 or P1 are never nits, whatever the file says. When the file gives a cap, keep that many of the most concrete nits and drop the rest. When it says no nits, file none. When it says nothing about nits, the usual bar stands: no style preference, no speculative future issue.

**Evidence.** A finding names a file and a line read in the current code. A guess from a name is not a finding. The designer, who does not read product source, cites the visual place instead, and still drops a finding whose subject the ignored paths name (a generated screen, a translation file's strings).

**The console** drops a senior finding whose `file` matches an ignored path from the copy (a leading `/` holds a pattern to the root, and a directory such as `dist/` covers what is under it), so it is not counted toward the habits of the next runs. A finding with no file is kept. The console does not judge nits: that stays with the reviewer.

## What the reports say

When the guide was read, the senior report names the source path in one line of `## Résumé` (`## Summary`) and says what it set aside (ignored paths, nits over the cap), or that it set nothing aside. QA and the design review do the same in their summary. The review summary has a section for it. When no guide was read, that line and that section say "Aucun" / "None", and nothing else about a guide.
