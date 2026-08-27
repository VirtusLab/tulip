import { ClaudeOutputError } from "../claude/errors.js";
import type { RunnerDeps } from "../claude/runner.js";
import type { JsonSchema } from "../claude/schema.js";
import { runSession } from "../claude/session.js";
import type { FileStatus } from "../diff/change.js";
import { CATEGORY_SCHEMA, type Category } from "./types.js";

/** A file touched by the PR, as listed for the category-generation prompt. */
export interface CategoryInputFile {
  path: string;
  status: FileStatus;
}

/** What phase 1 needs to know about the PR to propose categories. */
export interface GenerateCategoriesInput {
  title: string;
  description: string;
  files: CategoryInputFile[];
}

export interface GenerateCategoriesResult {
  /** In presentation order: most important / highest-impact first. */
  categories: Category[];
  /** Kept for phase 2's escape-hatch consultation (see ./consult.js). */
  sessionId: string;
}

const GENERATE_CATEGORIES_SCHEMA: JsonSchema = {
  type: "object",
  required: ["categories"],
  properties: {
    categories: { type: "array", items: CATEGORY_SCHEMA },
  },
};

function buildPrompt(input: GenerateCategoriesInput): string {
  const fileList = input.files.map((file) => `- ${file.path} (${file.status})`).join("\n");

  return `You are preparing to explain a GitHub pull request to a human reviewer.

PR title: ${input.title}

PR description:
${input.description.trim() || "(no description provided)"}

Changed files:
${fileList}

Before explaining the changes, group them into categories by functionality or
type. Each category should be a self-contained change: something a reviewer
could understand on its own. An ideal PR would be a single category, but that's
rare — larger PRs, even ones implementing a single feature, should be split
into several cohesive sub-categories. Keep any one category from covering too
many changes.

List the categories in the order they should be presented to the reviewer:
the most important, highest-impact category first.

For each category, give a short name and a one- or two-sentence description of
what it covers.`;
}

/**
 * Phase 1: primes a fresh sonnet session with the PR's title, description and file list, and
 * asks it to propose an ordered list of categories to group the PR's changes by. The returned
 * sessionId is later used by {@link import("./consult.js").consultOnCategory} when phase 2 wants
 * to add a category it didn't originally propose.
 */
export async function generateCategories(
  input: GenerateCategoriesInput,
  deps: RunnerDeps = {},
): Promise<GenerateCategoriesResult> {
  const { result, sessionId } = await runSession<{ categories: Category[] }>(
    { model: "sonnet", schema: GENERATE_CATEGORIES_SCHEMA, prompt: buildPrompt(input) },
    deps,
  );

  if (result.categories.length === 0) {
    throw new ClaudeOutputError("claude returned an empty category list");
  }

  return { categories: result.categories, sessionId };
}
