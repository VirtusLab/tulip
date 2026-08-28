import { ClaudeOutputError } from "../claude/errors.js";
import type { RunnerDeps } from "../claude/runner.js";
import type { JsonSchema } from "../claude/schema.js";
import { runSession } from "../claude/session.js";
import { config } from "../config.js";
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

Split the changes into a few groups so the reviewer can take them one at a time.
Each group should be one self-contained slice a reviewer can understand on its own,
together with its tests and its docs.

Group by what the change does — the concern it addresses — never by file type. Don't
make a "tests" group or a "documentation" group: tests and doc changes go in the same
group as the code they cover, so each group holds its main code, its tests, and its
docs together.

A group is usually one feature or one piece of behaviour. Repetitive or mechanical
code that recurs across the PR — say, serialization plumbing or delegating wrappers —
can also be a group of its own, since pulling it together lets the reviewer skim it
in one pass — this never means a tests or docs group; those still ride with their
code. The only test is whether the group stands on its own.

A small PR might be one group; a larger one is usually a few. Only split further when
each part still stands alone — don't cut one feature into "the hard part" and "the
wiring", since neither makes sense without the other. Keep any one group from covering
too much.

Order the groups by how much attention they need, most important first: new or tricky
logic, where a mistake would hurt most, before routine wiring or boilerplate. In each
description, say what the group covers and how closely to read it — for example "core
logic, read carefully" or "routine, skim". With no clear tricky-vs-routine split, just
order by impact.

For each group, give a short name and a one- or two-sentence description.`;
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
    {
      model: config.models.categoryGeneration,
      schema: GENERATE_CATEGORIES_SCHEMA,
      prompt: buildPrompt(input),
    },
    deps,
  );

  if (result.categories.length === 0) {
    throw new ClaudeOutputError("claude returned an empty category list");
  }

  return { categories: result.categories, sessionId };
}
