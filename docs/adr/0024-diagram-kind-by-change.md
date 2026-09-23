# 24. Diagram kind chosen by what changed

## Context

`src/prompts/explain.md` asked for an orienting diagram "where the flow of calls is worth a
picture — a call-sequence or flow/architecture diagram". `src/prompts/review.md` checked for a
diagram "where the flow warrants one". Both framed diagrams as pictures of call flow, so real
pages got sequence diagrams almost exclusively. Structural changes — new modules, new imports
between packages, new type hierarchies, schema changes — got no picture of the structure, which
is the part a reviewer who doesn't know the codebase needs most.

The renderer was never the limit: the vendored Mermaid 11.17.2 parses every diagram kind below,
and the headless validator (ADR 0008) accepts them.

## Decision

**Pick the diagram kind from what changed.** `explain.md` replaces the call-flow trigger with a
"Choosing a diagram" list mapping the change to a kind:

- new modules, packages, or imports between them — a dependency graph (flowchart) drawing only
  the imports this category adds or removes, added modules marked by stroke width (never color,
  the page has a light/dark theme), added imports as thick links. One new file with one caller
  is a sentence, not a graph.
- data or a call passing through stages — a data-flow flowchart with the passed data on the
  edges; branching logic — a control-flow flowchart.
- new or reworked types — `classDiagram`; a state machine — `stateDiagram-v2`; a database schema
  — `erDiagram`.
- the order or interleaving of calls, when that is what must be checked — `sequenceDiagram`.

Only these kinds. When several fit, the orienting diagram is the one the reviewer must hold in
mind; the rest go in prose. A before diagram is drawn only when the old shape is needed to judge
the new one. Width rules cover the new kinds (four classes or entities per diagram; package and
before/after subgraphs stacked with `~~~`).

**The reviewer checks restraint, not the list.** `review.md` does not repeat the mapping — a
copy drifts, and "is this the right kind" invites churn on judgment calls. It flags only the
concrete mismatches: a sequence diagram whose subject is structure, and a kind outside the
allowed set. Diagram edges are checked for correctness like prose claims.

## Alternatives considered

- **C4 and `architecture-beta`.** Both parse, but C4 lays out wide with little control, and
  architecture diagrams load icon packs over the network, which the self-contained page can't.
- **Mirroring the full kind list in the reviewer.** Rejected: the first draft did, and it had
  already drifted (a missing kind, narrower trigger phrases) before review.

## Consequences

- Prompt-only change; the four prompt snapshots under `src/explanations/__snapshots__` follow.
- The custom Mermaid theme (`src/rendering/assets/app.js`) was tuned against flowcharts and
  sequences only; class, state, and ER diagrams need a visual check on a real page.

## References

- ADR 0013 (signature-first explanations) named "a before/after call-sequence diagram" as one
  way to convey a method. That stands; this ADR widens what the orienting diagram may be.
- ADR 0008 (Mermaid render verification) — the validator every kind here passes.
