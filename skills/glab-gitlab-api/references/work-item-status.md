## Setting the ticket status

The status is **not a label**. It is the native work item status field, and it does not appear in
the REST issue API at all: `glab api projects/<id>/issues/<iid>` never returns it, and the
`.statut::*` scoped labels that exist on some projects are a separate, older thing. GraphQL is the
only way in.

The caller supplies the desired status and authorizes the update. Do not choose a lifecycle transition on its behalf.

Read first, and skip the write when the ticket already carries the right status:

```bash
glab api graphql -f query='
query {
  project(fullPath: "<group>/<project>") {
    workItems(iid: "<iid>") {
      nodes {
        id
        widgets { ... on WorkItemWidgetStatus { status { name } } }
      }
    }
  }
}'
```

One query gives both things you need: the current status name, and the global work item id
(`gid://gitlab/WorkItem/<numeric id>`), which the mutation requires and which is **not** the iid.

Then write it by name:

```bash
glab api graphql -f query='
mutation {
  workItemUpdate(input: {
    id: "gid://gitlab/WorkItem/<numeric id>",
    statusWidget: { name: "In progress" }
  }) {
    errors
    workItem { widgets { ... on WorkItemWidgetStatus { status { name } } } }
  }
}'
```

What matters:

- The name resolves case insensitively, so the board's exact casing does not have to be guessed:
  `in progress - merge request` reaches `In progress - Merge request`.
- An unknown name writes nothing and returns an explicit error listing every valid status for that
  work item type. Read that list instead of guessing a second time.
- `errors: []` plus the new name echoed back is the only proof the write landed. GraphQL returns
  HTTP 200 with a populated `errors` array on failure, so a successful call proves nothing on its own.
- Statuses come from the group lifecycle, so another project may expose other names. Resolve by
  name, never hardcode a status id.
- **This never blocks the run.** If the status cannot be set, note it in the final report and carry
  on. A ticket left on the wrong status is a board annoyance; a halted implementation is a real cost.
