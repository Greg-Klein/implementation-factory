# Ticket proposals file

A watcher outside the console looks for tickets (on GitLab by label, assignee and status, or anywhere else) and writes what it found to one file. The console reads that file and shows the tickets as proposals. The file is all the two share: the watcher never calls the console, and the console never asks GitLab for tickets.

The console works the same without the file. No file means no watcher and nothing proposed.

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
    { "url": "https://gitlab.com/acme/api/-/issues/42" }
  ]
}
```

- `tickets` is required. `url` is the address of a GitLab issue or work item; an entry without one is skipped.
- `title` and `source` are optional. `source` names what the watcher was looking at, a project or a group path.
- `version` and `generatedAt` are for the reader of the file; the console ignores them.

## Rules for the watcher

- **Write a snapshot, not a log.** The file lists every ticket that matches the filter right now, including the ones written before. A ticket that no longer matches is left out.
- **Write the file whole, then rename it into place.** A file caught half written does not parse; the console then keeps what it read last.
- **When a source cannot be asked, keep its tickets from the previous file.** A ticket that drops out of the file is forgotten by the console, and proposed again as new when it comes back.

## What the console does with it

- A ticket it already has (queued, held by a run, or behind an unmerged merge request) is not proposed.
- An accepted proposal is queued as a batch, exactly as pasted URLs are. A dismissed one is dropped. Either way the ticket is not proposed again while it stays in the file.
- The decisions are kept in `<data directory>/ticket-proposals-handled.json`, and a decision is forgotten as soon as its ticket leaves the file.
- Nothing starts on its own: a proposal opens no session and costs no tokens until the user launches it.
