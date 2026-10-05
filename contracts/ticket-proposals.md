# Ticket proposals file

A watcher outside the console looks for tickets (on GitLab or GitHub by label, assignee and status, or anywhere else) and writes what it found to one file. The console reads that file and queues every new ticket it names. The file is all the two share: the watcher never calls the console, and the console never asks GitLab for tickets.

The console works the same without the file. No file means no watcher and nothing queued.

Every example below is invented. The file holds ticket titles: it stays in the data directory, never in a tracked file.

## Location

`<data directory>/ticket-proposals.json`, or the absolute path in `IMPL_TICKET_PROPOSALS_FILE`. The console reads it every `IMPL_PROPOSALS_POLL_MS` milliseconds (default 5000). How often the watcher asks its source is the watcher's own setting.

## Content

```json
{
  "version": 1,
  "generatedAt": "2026-10-03T09:30:00.000Z",
  "tickets": [
    { "url": "https://gitlab.com/acme/shop/-/work_items/101", "title": "Fix the cart total", "source": "acme/shop" },
    { "url": "https://gitlab.com/acme/api/-/issues/42" },
    { "url": "https://gitlab.com/acme/shop/-/work_items/102", "title": "Show the loyalty points", "baseBranch": "feat-87-loyalty-program" }
  ]
}
```

- `tickets` is required. `url` is the address of a GitLab issue or work item, or of a GitHub issue; an entry without one is skipped.
- `title` and `source` are optional. `source` names what the watcher was looking at, a project or a group path.
- `baseBranch` is optional: the branch the work starts from and the merge request targets, typically the feature branch of the ticket's epic. Write it only when the watcher knows it. Without it, the workflow asks the user for the base when there is more than one candidate. A name that is not a plain git branch name is ignored. A branch that does not exist makes the workflow ask the user, never pick another base by itself.
- `version` and `generatedAt` are for the reader of the file; the console ignores them.

## Rules for the watcher

- **Write a snapshot, not a log.** The file lists every ticket that matches the filter right now, including the ones written before. A ticket that no longer matches is left out.
- **Write the file whole, then rename it into place.** A file caught half written does not parse; the console then keeps what it read last.
- **When a source cannot be asked, keep its tickets from the previous file.** A ticket that drops out of the file is forgotten by the console, and proposed again as new when it comes back.

## What the console does with it

- A ticket it already has (queued, held by a run, or behind an unmerged merge request or pull request) is left alone.
- Every other ticket is queued as soon as the file is read, without the user. The tickets read together are one batch, exactly as pasted URLs are, so the tickets of one repository are analysed together and the queue decides when each one runs. Each carries its `baseBranch`, which reaches the session as `IMPL_TICKET_BASE_BRANCH`. A stacked start from the queue replaces it with the branch of the ticket it stacks on.
- Every run costs tokens: the watcher's filter is the only thing that limits what is launched, beside the slots and the queue.
- A ticket that cannot be launched (no checkout, no `claude` binary) is listed in the console with the reason and is not tried again until it leaves the file or the console restarts. The user can dismiss it.
- A ticket queued or dismissed is recorded in `<data directory>/ticket-proposals-handled.json` and is not queued again while it stays in the file, even when it is cancelled from the queue. A decision is forgotten as soon as its ticket leaves the file.
