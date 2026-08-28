import type { JsonSchema } from "../claude/schema.js";

/**
 * One group of cohesive, self-contained changes, as presented to the reviewer. Identified by a
 * short, code-assigned `id` ("c1", "c2", ...) — never by `name`, which is free text a model
 * can't be trusted to reproduce verbatim between calls (see docs/adr/0005). Classification
 * (src/classification) matches and refers to categories by `id`; `name`/`description` are for
 * display only.
 */
export interface Category {
  id: string;
  name: string;
  description: string;
}

/**
 * Shape a model proposes for a category — name and description only. Ids are never invented by
 * the model: they're assigned in code, in presentation order, by {@link assignCategoryIds} (a
 * freshly generated phase-1 list) or {@link nextCategoryId} (a single new category accepted
 * mid-run via the escape hatch, src/classification/escape-hatch.ts).
 */
export interface CategoryProposal {
  name: string;
  description: string;
}

/** Shared by every schema below that embeds a model-proposed category (no `id` — see
 * {@link CategoryProposal}). */
export const CATEGORY_SCHEMA: JsonSchema = {
  type: "object",
  required: ["name", "description"],
  properties: {
    name: { type: "string" },
    description: { type: "string" },
  },
};

/** Assigns ids "c1", "c2", ... to a freshly generated, ordered category list (c1 = most
 * important) — see src/categories/generate.ts. */
export function assignCategoryIds(proposals: CategoryProposal[]): Category[] {
  // `id` spread last: a stray `id` key on a parsed proposal (CATEGORY_SCHEMA has no
  // additionalProperties:false, so nothing strips one) must never override the code-assigned id.
  return proposals.map((proposal, index) => ({ ...proposal, id: `c${index + 1}` }));
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
