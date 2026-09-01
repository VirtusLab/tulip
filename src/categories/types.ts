import type { JsonSchema } from "../claude/schema.js";

/**
 * How closely a reviewer should read a category (docs/adr/0010): a formalization of ADR 0003's
 * prose attention signal into a first-class, model-assigned field. Rates a group already formed
 * by concern — it never influences how the PR is split. Ordering rank, closest read first:
 * `close` (0) < `normal` (1) < `skim` (2) — see {@link assignCategoryIds}.
 */
export type Attention = "close" | "normal" | "skim";

/** All attention levels, in rank order (closest read first) — the single source of truth for
 * both the schema enum and the sort/rank table below. */
export const ATTENTION_LEVELS: readonly Attention[] = ["close", "normal", "skim"];

/** Derived from {@link ATTENTION_LEVELS}'s position, not hand-written — so a future level
 * addition/reorder can't desync the rank table from the enum it's supposed to mirror. */
const ATTENTION_RANK: Record<Attention, number> = Object.fromEntries(
  ATTENTION_LEVELS.map((level, index) => [level, index]),
) as Record<Attention, number>;

/**
 * One group of cohesive, self-contained changes, as presented to the reviewer. Identified by a
 * short, code-assigned `id` ("c1", "c2", ...) — never by `name`, which is free text a model
 * can't be trusted to reproduce verbatim between calls (see docs/adr/0005). Classification
 * (src/classification) matches and refers to categories by `id`; `name`/`description`/
 * `attention` are for display only.
 */
export interface Category {
  id: string;
  name: string;
  description: string;
  attention: Attention;
}

/**
 * Shape a model proposes for a category — name, description and attention; no `id`. Ids are
 * never invented by the model: they're assigned in code, in presentation order, by
 * {@link assignCategoryIds} (a freshly generated phase-1 list) or {@link nextCategoryId} (a
 * single new category accepted mid-run via the escape hatch, src/classification/escape-hatch.ts,
 * which also overrides `attention` — see that module).
 */
export interface CategoryProposal {
  name: string;
  description: string;
  attention: Attention;
}

/** One issue the category review (./review.ts) raised against a proposed split — mirrors
 * src/explanations/types.ts's ReviewIssue. */
export interface ReviewIssue {
  description: string;
}

/** Shared by every schema below that embeds a model-proposed category (no `id` — see
 * {@link CategoryProposal}). `attention` is a hard-constrained enum, like the classification
 * codeType/id enums (src/classification/wire.ts) — the model must pick one of the three levels. */
export const CATEGORY_SCHEMA: JsonSchema = {
  type: "object",
  required: ["name", "description", "attention"],
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    attention: { type: "string", enum: [...ATTENTION_LEVELS] },
  },
};

/** Stable-sorts anything with an `attention` field by rank (`close` before `normal` before
 * `skim` — docs/adr/0010); items tied on attention keep their relative order (`Array.prototype
 * .sort` is spec-stable, ES2019+). Shared by {@link assignCategoryIds} (proposals, before ids
 * are assigned) and by classification's final presentation-order sort
 * (src/classification/orchestrate.ts, applied once after escape-hatch/coverage is done, not
 * per-acceptance — see that module) — the one place order = attention is actually finalized. */
export function sortByAttention<T extends { attention: Attention }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => ATTENTION_RANK[a.attention] - ATTENTION_RANK[b.attention]);
}

/** Assigns ids "c1", "c2", ... to a freshly generated category list, in presentation order:
 * proposals are stable-sorted by attention rank first (see {@link sortByAttention}), so `c1` is
 * always the first Read-closely group. Ordering is no longer authored by the model (see
 * src/prompts/category-generation.md). */
export function assignCategoryIds(proposals: CategoryProposal[]): Category[] {
  const ordered = sortByAttention(proposals);
  // `id` spread last: a stray `id` key on a parsed proposal (CATEGORY_SCHEMA has no
  // additionalProperties:false, so nothing strips one) must never override the code-assigned id.
  return ordered.map((proposal, index) => ({ ...proposal, id: `c${index + 1}` }));
}

/** Next fresh, unique category id continuing the "c<N>" sequence, given the current category
 * list — used when the escape hatch (src/classification/escape-hatch.ts) accepts a new category
 * mid-run. Derived from the max existing numeric suffix (not just `.length + 1`), so it can't
 * collide even if ids were ever reordered. */
export function nextCategoryId(categories: Category[]): string {
  const maxIndex = categories.reduce((max, category) => {
    const match = /^c(\d+)$/.exec(category.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `c${maxIndex + 1}`;
}
