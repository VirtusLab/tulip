# 18. One `Change` = one diff: combined modifications, two-range snippets, kind-agnostic splitting

## Context

`parseHunkBody` (`src/diff/parse-diff.ts`) splits a modified line into two `Change`s —
a base-side (removed) and a head-side (added). Coverage (`isCovered`,
`src/explanations/coverage.ts`) matches strictly by side, so both must be snippeted;
but a modified-file snippet renders both panes for either ref, so the two snippets
render the *identical* side-by-side diff (the explainer even labels them
"Before:"/"After:"). A change should map to one rendered diff.

Two follow-ons fall out of fixing this: the snippet markup is single-side (so a
modification can't be referenced as one thing), and the ADR-0016 splitter assumes
single-sided changes (so a large in-place rewrite couldn't be split).

## Decision

**A `Change` carries both sides; a snippet reference carries the change's own
coordinates and renders per-region; the splitter cuts any kind by paired boundaries.**

### A. Diff model
```
interface ChangeSideContent { range: LineRange; lines: string[] }  // lines keep +/- markers
interface Change { id: string; path: string; base?: ChangeSideContent; head?: ChangeSideContent }
```
- Invariant: ≥1 of `base`/`head` (construction throws otherwise). Kind is *derived*,
  never stored — head-only = addition, base-only = deletion, both = modification.
  Helpers in `change.ts`: `changeKind`, `changeDiffLines` (base lines then head lines).
- `parseHunkBody` groups an adjacent removed-run + added-run into ONE modification: a
  `+` no longer flushes a pending `-` run; a context line flushes; a `-` after the
  added run began starts a new group; add-before-delete stays two single-sided
  changes. (`-a -b +c +d` → one modification; `-a`·ctx·`+c` → deletion + addition.)
- **id** (`changeId(path, { base?, head? })`): addition `path:head:s-e` and deletion
  `path:base:s-e` unchanged from today; modification `path:mod:bs-be:hs-he` (new,
  disjoint namespace). Ids stay opaque, code-assigned, never parsed (ADR 0005).

### B. Two-range snippets, per-region rendering
- Snippet markup becomes `{{snippet path base="bs-be" head="hs-he" unfold}}` (base
  and/or head, ≥1), mirroring the change. `SnippetRef` becomes
  `{ path, base?, head?, unfold }`.
- The renderer aligns *that reference's own* base and head lines into a fresh mini-diff
  (per-region), so one change → one snippet → one correctly-paired diff. A split
  sub-modification renders only its own lines, so adjacent split pieces do not overlap.
  Pane layout follows the ref's present sides (a pure add/del inside a modified file
  now renders single-pane, not two-pane with a blank side).
- **Coverage:** a change is covered iff each present side's range is covered by
  same-side refs — one two-range ref covers a modification in full. Nothing is left
  uncoverable; no side-picking.
- **Expand-context stays (GitHub model), reworked range-based:** expansion reveals the
  adjacent unchanged file lines by *line number* (walking the whole-file rows
  `template.ts` embeds), not by whole-file row index — so it works for whole snippets
  and split pieces alike. The only place with no expander is the seam between two split
  pieces of the same change, where no context is hidden (as on GitHub).

### C. Kind-agnostic splitter (generalizes ADR 0016)
- Candidate: total changed lines `(base + head)` over `config.limits.splitThreshold`,
  any kind.
- A split boundary carries a base and/or head position; `buildPartition` tiles **both**
  axes, so coverage is guaranteed per side by construction. For a modification each
  boundary carries both coordinates and is validated/dropped **as a pair** (keeping the
  axes at equal segment counts); a segment with no lines on a side is an
  addition/deletion, both → a modification. Empty/invalid boundaries → the change
  passes through whole. So large additions, deletions, and in-place rewrites all split
  and disperse across categories.

## Consequences

- The duplicate "Before/After" diff is gone at the source: a modification is one
  change, one snippet, one diff.
- `ClassifiableChange` drops flat `side`/`range`/`lines` for `base?`/`head?` — the
  widest ripple, through classification (prepare/excerpt/prompt/coverage message) and
  the explainer (`formatChange`, `isCovered`).
- Rendering is in scope (unlike a smaller single-side design): two-range markup,
  per-region alignment, range-based expand. `line-diff.ts`'s `buildAlignedDiff` is
  reused on a region rather than the whole file.
- Splitting now asks the model for paired cuts on a modification; code still owns
  coverage, so a poor cut is a worse grouping, never a lost line.
- Grouping/ownership (ADR 0015) and `pipeline/run.ts` are unaffected (id-keyed /
  file-level). `template.ts` embedding is unchanged; only expand's addressing changes.

The consumer ripple table, the `parseHunkBody`/`buildPartition` state machines, the
commit order, and the full diff-shape test matrix live in the implementation plan
(`.superpowers/sdd/PLAN/0018-*`).

## References
- ADR 0005 (change identity by id) — ids stay code-assigned/opaque; adds the `mod:` form.
- ADR 0016 (split large changes) — this ADR supersedes its single-axis splitter and its
  "no Change-model change" assumption.
- ADR 0015 (primary-owner ledger) — unaffected (id-keyed); still de-dups a change
  shared across categories.
- ADR 0009/0013 — the snippet markup and single-side render assumptions this revises.
