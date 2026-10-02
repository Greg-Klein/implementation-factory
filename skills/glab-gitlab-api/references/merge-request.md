The caller must authorize publication and supply the source/target branches, ticket, verdict, artifacts and delivery policy. This recipe does not authorize merging or unrelated ticket updates. References to step numbers below name the Harness caller stages, not additional automatic actions.

# Authorized merge request delivery

**Read the acceptance summary first.** When the console runs the session (`IMPL_RUN_ID` is set), it keeps `.claude/tasks/acceptance-summary.md` up to date from the registry and every evidence file, with the same computation its "Preuves" tab shows: one sentence ("5 critères vérifiés sur 8 · 1 échec · 1 bloqué · 1 non vérifié"), the criteria that are not verified and why, and a detail table for step 9. Use it as it is. A criterion it reports unverified, blocked or failed is never reworded as validated, anywhere. When the file is absent (no console), write the same content yourself from the registry and the evidence files, by the same rule: a criterion is verified only when evidence taken on the final code says so.

That summary feeds the decisions this workflow already takes; it is not a second verdict. A criterion in failure is an acceptance criterion not met, which is a `P0` of the review loop and, if still open, the draft case below. A blocked criterion goes under `## Blocked` when the merge request is a draft, and into the step 9 comment as not verified otherwise.

Write the description to `.claude/tasks/mr-description.md` first, applying `implementation-harness:unslop`, then push the branch and open the merge request in one call, as a normal merge request (not a draft) targeting the base branch from step 2.

```bash
git push -u origin <branch>
glab api --method POST "projects/:fullpath/merge_requests" \
  --field "source_branch=<branch>" \
  --field "target_branch=<base>" \
  --field "title=feat: <english title>" \
  --field "description=@.claude/tasks/mr-description.md" \
  --field "remove_source_branch=true"
```

Two things this creation call settles, and neither is optional:

- **The description comes from the file, never from the command line.** `--field "key=@<file>"` reads the file instead of passing its content through the shell, so the backticks and the quotes of a long Markdown description survive intact. `glab mr create` has no file flag for the description, only `-d`, which is why the REST endpoint replaces the subcommand here rather than being paired with it.
- **No filler content is ever published, not even for a second.** A merge request is public the instant it exists: it fires a notification, mails the subscribers, and whoever opens the link in that window reads what is there. Creating one with a stand-in description and patching it a moment later puts fake content in front of real people, and `placeholder` reads as a botched description rather than as a transient state. The description is written before the merge request, never after.

The response carries `iid` and `web_url`; keep both, steps 9 and 10 need them. For the blocked case above, prefix the title with `Draft: ` - the REST call has no `--draft` flag.

**Then apply the caller’s reviewer policy, in a second call.** Use the supplied reviewer identity. Only when the caller requests the initiating user as reviewer, resolve that identity with `glab api user`; do not override a different supplied reviewer. If the caller explicitly requests no reviewer, skip this assignment and record that policy.

```bash
glab api user                                        # only for the initiating-user policy
glab mr update <iid> --reviewer <username>
glab api "projects/:fullpath/merge_requests/<iid>"   # read "reviewers" back
```

- **The subcommand, not the REST field.** `glab api --method PUT … --field "reviewer_ids[]=<id>"` answers **HTTP 400**: that array form is not accepted here. `glab mr update --reviewer` answers `requested review from "@<username>"` and is the form that works.
- `glab api` has no `--jq` flag, so read the field out of the JSON response rather than filtering it on the command line.
- **Read it back, always.** The third call is not a formality. This field is in the same family as the `assignee_ids` that GitLab accepts and ignores, so a call that returns without error proves nothing. The reviewer is set when you have read the name back out of `reviewers`, and a reviewer you could not read back is reported as not set.
- Reviewer and assignee are two different fields. Setting the first never sets the second, and the Harness delivery policy uses no assignee.

Rules:

- Title in English, conventional prefix (`feat:`, `fix:`, `refactor:`)
- **No assignee at all.** Do not assign the MR to anyone. The reviewer is a different field, governed by the supplied reviewer policy
- No manual label, no estimate
- **Always link the MR to its ticket**, without exception. Two things, both required:
  - the full ticket URL on the first line of the description, so the link is visible and clickable whatever GitLab does with keywords
  - the keyword: `Closes #<iid>` when the target is the project's default branch, `Related to #<iid>` otherwise (a merge into a feature branch closes nothing, so `Closes` would be a lie)
  - both go into the description file before the merge request is created, so the link is there from the first second
- **Never merge the MR yourself.** The user merges.
- **"Livré" means deployed to production**, in the description and in the step 9 comment alike. A ticket whose merge request is open, or merged into a feature branch or `develop`, is not "livré": name the stage it reached ("MR ouverte", "mergé dans `<branch>`").

If the caller separately authorized a ticket lifecycle transition, perform that supplied transition using [work-item-status.md](work-item-status.md). MR creation alone does not authorize a status update.

Description template (`.claude/tasks/mr-description.md`). **Keep it short.** A reviewer reads the code, not a report: aim for 25 lines or so, and never pad it to look thorough.

```md
<full ticket URL>

Closes #<iid> or Related to #<iid>, according to target

## Résumé

Two or three sentences: the user facing problem, and what happens instead now.

## Changements

Three to five bullets, one per notable item. File names only when they help the reader find their way.

## Critères d'acceptation

The summary sentence, then one bullet per criterion that is not verified, with its reason in a few words. Nothing more: the detail goes in the step 9 comment. Omit the bullets when every criterion is verified.

## Notes d'implémentation

Only what the code cannot say on its own: a decision that looks like a mistake and would get "fixed", a deliberate widening or narrowing of the ticket, a trap. Two or three at most, and having none is a valid outcome. If a note only describes what the diff shows, drop it.

Hors scope selon le ticket : ...
```

What does **not** belong in the description, because it is noise for the reviewer:

- test counts, coverage percentages, lint and typecheck output, build status. It either passes or the MR is not ready
- the list of everything that was verified, or verified in a browser
- design conformance tables, before and after values, findings and their severities
- follow-up ideas, out of scope discoveries, open product questions
- the reasoning history: what was asked, what was deduced, what was arbitrated

All of that either belongs in the review comment of step 9, or nowhere. The description answers "what changed and why", nothing else.

One more thing is banned here, for a different reason than noise: **the link to the engine's session**, and the `Co-Authored-By` trailer. That is the step 5 rule, and it holds for this description and for the step 9 comment exactly as it holds for a commit message.

**Nothing about the machine that ran the session**, in the description or in the step 9 comment: its shell hooks and command wrappers, the environment prefix its commands needed, its local paths, the workaround a reviewer used to get a true output. The people on the merge request do not have that machine, so they can neither reproduce nor act on it, and it publishes the operator's setup. A check that could not run is still reported, in terms of the project (which command, what it could not establish). Anything about the machine goes to the final report of step 10.

---

## Publish the consolidated review

Once the caller supplies the final verdict and review artifacts, publish the consolidated review as a comment on the merge request. This is mandatory, on a `READY` verdict as well as on a `BLOCKED` one.

Build it from the sources step 7 named for your tier (`review-summary.md` at tier 2, the reviewers' own artifacts below it) plus the per round archives, write it to `.claude/tasks/mr-review-comment.md`, then post it:

```bash
glab api --method POST projects/<id>/merge_requests/<mr_iid>/notes \
  --field "body=@.claude/tasks/mr-review-comment.md"
```

**A screenshot that backs a claim travels with the comment, not just in words.** `.claude/tasks/assets/` is only a path on this machine; nobody reading the merge request can open it, so a verification described in prose with no image reachable from there is unverifiable to that reader, whatever proof sat in the run's evidence. Before posting, upload every screenshot that backs a claim in the report (skip a debug capture nobody cites) to the project, one call per file:

```bash
curl -sS --request POST \
  --header "PRIVATE-TOKEN: $(glab config get token --host <host>)" \
  --form "file=@.claude/tasks/assets/<name>.png" \
  "https://<host>/api/v4/projects/<url-encoded-project-path>/uploads"
```

`<host>` is the GitLab host of the ticket URL, `gitlab.com` in the normal case. **This is the one call in the workflow that `glab api` cannot make.** `POST /uploads` only accepts `multipart/form-data`, while `--field` and `--raw-field` only ever build a JSON body: `glab api --method POST .../uploads --field "file=@<path>"` sends the bytes of the PNG as a JSON string and GitLab answers `400 Bad Request`, on every project and every file. Reaching for `glab mr note` instead does not help either, because the image has to exist on the project before any comment can link to it.

The response's `markdown` field is already a ready-to-embed image link. Paste each one under `### Captures`, with a one-line caption naming what it proves. An upload that fails leaves its claim without an image: say so in the `### Validation` section rather than dropping the caption silently or pointing at a local path.

Use [conventional comments](https://conventionalcomments.org/) for each finding, exactly like `/implementation-harness:review`:

```md
## Revue automatisée

Les revues senior, QA et design ont tourné sur N rounds. Les constats ci-dessous sont ce qui reste après la boucle de retouches.

### Constats

**issue (blocking):** `path/file.ts:42` - sujet

Why it matters, in one or two sentences.

**suggestion (non-blocking):** `path/file.tsx:15-28` - sujet

What to change and why.

**nitpick (non-blocking):** `path/file.tsx:60` - sujet

**praise:** `path/file.ts:10` - sujet

### Corrigé pendant la boucle

- [P0] ... (relevé par senior, corrigé au round 2, confirmé par QA)

### Critères d'acceptation

The detail table of `.claude/tasks/acceptance-summary.md`. Every attachment it names is a local path: link it only once uploaded as below, with the returned link; one that was not uploaded is written "capture restée locale", never as a path.

### Validation

- Lint / typecheck / tests : ...
- Vérification navigateur : routes et viewports, ou pourquoi ça n'a pas pu tourner
- Revue design : comparée à Figma / ignorée et pourquoi

### Captures

![légende décrivant ce que la capture prouve](lien markdown renvoyé par l'upload)

### Verdict

`à merger` | `changements mineurs` | `à retravailler` - one or two sentences.

N blocking - N non-blocking - N nitpicks - N praise
```

Rules for this comment:

- Everything in French and written with `implementation-harness:unslop`, code findings anchored on `file:line`; design findings use visual location and frame/criterion references
- Only what survived the loop, plus what was fixed. No speculation, no hypothetical future problems
- Honest about what could not be verified. Never claim a browser or design check that did not happen
- `### Validation` gives project commands and their results, never how this machine had to run them (see the machine rule above)
- One single comment, not one per finding
- Every screenshot cited as evidence is uploaded and embedded, never left as a local path GitLab cannot resolve; omit the `### Captures` section entirely when no browser evidence exists to back it
- If the API call fails, fall back to `glab mr note <mr_iid> --message "$(cat .claude/tasks/mr-review-comment.md)"` and report the fallback
