# Architecture decision records

An architecture decision record (ADR) captures one significant decision: the
context that forced it, what was decided, what follows from it and which
alternatives were rejected. It is short, it is dated, and once accepted it is
not rewritten.

ADRs sit beside the other two kinds of design document:

- A **spec** (`../specs/`) describes how a whole feature works and is kept
  current as the feature changes.
- An **ADR** records why one cross-cutting decision was made, at the moment it
  was made. When the decision changes, a new ADR supersedes it; the old one
  stays as history.

Write an ADR when a decision constrains code that has not been written yet: a
contract other packages will build on, a rule several modules must follow, or
a choice that would be expensive to reverse. A decision that lives inside one
feature belongs in that feature's spec instead.

## Numbering and file names

- File name: `NNNN-kebab-title.md`, four digits, zero-padded
  (`0001-org-aware-principal-and-scope.md`).
- Take the next free number when you open the pull request. If two branches
  pick the same number, the one that merges second renumbers before merging.
- A merged ADR is **never renumbered or renamed**. Other documents and code
  comments link to it by path.

## Statuses

| Status | Meaning |
|---|---|
| Proposed | Under discussion. Code must not depend on it yet. |
| Accepted | In force. Code and specs follow it. |
| Superseded by NNNN | Replaced by a later ADR. Kept unchanged as history; only the status line and a link to the successor are edited. |

An accepted ADR may gain an "Implemented in" or follow-up note at the bottom.
Its Decision section is not edited after acceptance; a changed decision is a
new ADR.

## Template

Copy this into `docs/adr/NNNN-kebab-title.md` and add a row to the index below.

```markdown
# NNNN. Title in sentence case

- **Status:** Proposed
- **Date:** YYYY-MM-DD
- **Deciders:** who agreed
- **Tracking:** issue or epic link

## Context

The forces at play: the problem, the constraints, what exists today (with
file paths), and the spec sections this builds on.

## Decision

What was decided, stated as rules. Include the exact contract (types, names,
derivation rules) when the decision is a contract.

## Consequences

What changes because of this, and in which later piece of work. What becomes
easier, what becomes harder, and what is now forbidden.

## Alternatives considered

Each rejected option with the reason it lost.

## References

Specs, code paths and issues.
```

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-org-aware-principal-and-scope.md) | Org-aware principal and scope | Accepted |
| [0002](0002-database-packaging-and-rls.md) | Database packaging and row-level security | Accepted |
