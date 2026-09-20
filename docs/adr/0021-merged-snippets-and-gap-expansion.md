# 21. Merged same-file snippets and gap-row expansion

## Context

Each `{{snippet}}` ref rendered its own block, so an explanation touching one file in three
places showed three blocks with no sense of the file between them. "Expand context" revealed
20 rows per click but stopped at the first changed row and then removed its button; most
snippets sit in gaps shorter than 20 lines, so it looked like it worked once. Two smaller
defects: after an expansion only the anchor side's bounds were updated, and the seam between
two split pieces of one change had no expander (ADR 0018).

## Decision

- **Grouping at render time, adjacency only.** `markdown.ts` groups consecutive refs to one
  path with only whitespace between them into a run; one run renders as one block. Prose or an
  HTML comment between refs keeps them separate. No markup or coverage change; the model keeps
  writing one ref per change (ADR 0018), and one prompt sentence tells it that adjacent refs
  merge.
- **Regions bounded on both sides.** A region's whole-file row range is the min/max index of
  any row holding one of its lines, on either side. Anchor-side-only bounds would leave the
  longer side's trailing lines in a gap. Hidden ranges are computed with a running cursor over
  the regions in file order, so overlapping or nested row ranges (split pieces straddle paired
  rows) never re-expose a region's rows. Refs whose line ranges overlap split the run.
- **Gap rows own their range.** Each hidden range is a `tr.snippet-gap` with `data-from-row`,
  `data-to-row` and `data-position`. A click reveals up to 20 rows from the end the button points
  at, and the row re-renders or disappears when empty. Expansion therefore continues to the
  file edge or the next region, and crosses changes that belong to other blocks, showing them
  as add/remove rows as GitHub does. A gap of at most 20 rows gets one "expand N lines" button.
- **Pane mode from the file, not the ref.** Single-pane only when every whole-file row lacks
  the other side. A single-pane row renders no cells for the other side, so a revealed
  removed row in a head-only block would come out blank. Consequence: an addition inside a
  modified file now renders split with a blank base pane, as GitHub's split view does.
- **Parity.** `renderGapRow` and `EXPAND_STEP` join the byte-mirrored `app.js` slice; a jsdom
  test drives the real `app.js` through clicks.

## Consequences

- One block per adjacent run; the summary lists every region's ranges.
- Expansion can reveal a lot of a file; files over the 200 KB embed cap keep label-only gaps.
- Contiguous split pieces merge with no seam row, resolving ADR 0018's limitation.

## References

- ADR 0018 (one change, one diff; two-range refs; per-region alignment).
- ADR 0009 / 0011 (snippet layout rules the block still lives in).
