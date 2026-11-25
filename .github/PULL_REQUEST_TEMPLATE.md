## Story ID
<!-- e.g. F-01, RT-03 — required, not optional -->

## Changes made to the codebase
<!-- What was added, modified, or removed. Be specific about files/modules
     touched, not just "updated server". -->

## Effects of these changes
<!-- What behaviour changes as a result — for users, for other services,
     for the API contract, for the data model, etc. Call out anything
     that could break an existing caller or teammate's in-progress work. -->

## Decisions made along the way
<!-- Any judgment calls, trade-offs, or alternatives considered while
     implementing this — especially anything not obvious from the diff
     alone. If a decision is significant enough to matter later, also
     add it to docs/devguides/DECISIONS.md in this same PR. -->

## Checklist
- [ ] Tests pass locally (`docker-compose up` + manual smoke test)
- [ ] Docs updated — if this PR changes behaviour, architecture, or a known
      pitfall, the relevant file is updated in this same PR:
      CLAUDE.md · docs/areas/ · README.md · docs/devguides/DECISIONS.md
- [ ] No credentials or `.env` values committed
- [ ] Reviewed by at least one other team member
