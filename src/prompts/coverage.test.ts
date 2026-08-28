import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderPrompt, templatePlaceholders } from "./loader.js";

/**
 * For every prompt template (`src/prompts/*.md`), the exact set of vars its real TS call site
 * supplies — mirroring the calls in ../categories/generate.ts, ../categories/consult.ts,
 * ../classification/prompt.ts and ../explanations/prompt.ts. This is the runtime guard docs/adr
 * /0006 trades for TS's lost compile-time field coupling: keep this manifest's key sets in sync
 * with both the `.md` files' `{{placeholders}}` and the real call sites — a mismatch in either
 * direction fails the test below via `renderPrompt`'s strict checking.
 */
const CALL_SITE_VARS: Record<string, string[]> = {
  preamble: [],
  "category-generation": ["title", "description", "fileList"],
  "category-consult": ["proposedName", "path", "range", "excerpt"],
  "classify-special-categories": [],
  "classify-output-instructions": [],
  "classify-initial": ["categoryList", "specialCategories", "outputInstructions", "changes"],
  "classify-next-batch": ["categoryList", "changes"],
  "classify-escape-hatch-outcome-accepted": ["categoryName", "categoryId"],
  "classify-escape-hatch-outcome-rejected": [],
  "classify-escape-hatch": ["categoryList", "outcomes"],
  "classify-coverage-repair": [
    "categoryList",
    "specialCategories",
    "outputInstructions",
    "changes",
  ],
  "explain-markup-instructions": [],
  "explain-production-checklist": [],
  "explain-test-checklist": [],
  "checkout-access": ["headSha", "baseSha"],
  explain: [
    "prTitle",
    "prDescription",
    "categoryName",
    "categoryDescription",
    "markupInstructions",
    "productionChanges",
    "testChanges",
    "checkoutAccess",
    "productionChecklist",
    "testChecklist",
  ],
  "explain-coverage-amend": ["missing"],
  review: [
    "prTitle",
    "prDescription",
    "categoryName",
    "categoryDescription",
    "markdown",
    "productionChanges",
    "testChanges",
    "checkoutAccess",
  ],
  "review-amend": ["issues"],
};

const PROMPTS_DIR = fileURLToPath(new URL(".", import.meta.url));
const templateNames = readdirSync(PROMPTS_DIR)
  .filter((name) => name.endsWith(".md"))
  .map((name) => name.slice(0, -".md".length))
  .sort();

describe("prompt template placeholder coverage", () => {
  it("has a CALL_SITE_VARS manifest entry for every src/prompts/*.md file, and vice versa", () => {
    expect(Object.keys(CALL_SITE_VARS).sort()).toEqual(templateNames);
  });

  it.each(templateNames)("%s: template placeholders exactly match the call site's vars", (name) => {
    const vars = CALL_SITE_VARS[name] ?? [];
    const sampleVars = Object.fromEntries(vars.map((key) => [key, "x"]));

    expect(() => renderPrompt(name, sampleVars)).not.toThrow();
    expect(templatePlaceholders(name)).toEqual(new Set(vars));
  });
});
