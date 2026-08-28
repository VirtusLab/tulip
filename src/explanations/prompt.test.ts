import { describe, expect, it } from "vitest";
import type { Category } from "../categories/types.js";
import type { ClassifiableChange } from "../classification/types.js";
import {
  GOLDEN_EXPLAIN_COVERAGEAMEND,
  GOLDEN_EXPLAIN_DEFAULT,
  GOLDEN_EXPLAIN_EMPTYTEST,
  GOLDEN_EXPLAIN_OVERTHRESHOLD,
  GOLDEN_REVIEW_AMEND,
  GOLDEN_REVIEW_DEFAULT,
} from "../prompts/__fixtures__/golden.js";
import {
  buildCoverageAmendPrompt,
  buildExplainPrompt,
  buildReviewAmendPrompt,
  buildReviewPrompt,
} from "./prompt.js";
import type { ExplainCategoryInput, ReviewIssue, ReviewPromptInput } from "./types.js";

const CATEGORY: Category = { id: "c1", name: "Retry logic", description: "Adds backoff retries." };

function change(overrides: Partial<ClassifiableChange> = {}): ClassifiableChange {
  return {
    id: "c1",
    path: "src/fetch.ts",
    status: "modified",
    side: "head",
    range: { start: 10, end: 12 },
    excerpt: "+line1\n+line2\n+line3",
    lines: ["+line1", "+line2", "+line3"],
    ...overrides,
  };
}

const EXPLAIN_INPUT: ExplainCategoryInput = {
  prTitle: "Add retry logic to the fetcher",
  prDescription: "Retries transient network failures with backoff.",
  category: CATEGORY,
  production: [change()],
  test: [change({ id: "c2", path: "src/fetch.test.ts", excerpt: "+test1", lines: ["+test1"] })],
  diffThreshold: 100,
  baseSha: "abc123base",
  headSha: "def456head",
};

// Byte-identical regression guards (docs/adr/0006): asserts the loader-rendered prompt equals
// the OLD template-literal builder's output for the same inputs, captured before the refactor.
describe("buildExplainPrompt", () => {
  it("renders byte-identical prompt output", () => {
    expect(buildExplainPrompt(EXPLAIN_INPUT)).toBe(GOLDEN_EXPLAIN_DEFAULT);
  });

  it("renders byte-identical prompt output when a change's range is over the diff threshold", () => {
    const input: ExplainCategoryInput = {
      ...EXPLAIN_INPUT,
      production: [change({ range: { start: 1, end: 500 } })],
      diffThreshold: 3,
    };

    expect(buildExplainPrompt(input)).toBe(GOLDEN_EXPLAIN_OVERTHRESHOLD);
  });

  it("renders byte-identical prompt output with an empty test-changes list", () => {
    const input: ExplainCategoryInput = { ...EXPLAIN_INPUT, test: [] };

    expect(buildExplainPrompt(input)).toBe(GOLDEN_EXPLAIN_EMPTYTEST);
  });
});

describe("buildCoverageAmendPrompt", () => {
  it("renders byte-identical prompt output", () => {
    const missing = [change(), change({ id: "c2", path: "src/fetch.test.ts" })];

    expect(buildCoverageAmendPrompt(missing)).toBe(GOLDEN_EXPLAIN_COVERAGEAMEND);
  });
});

describe("buildReviewPrompt", () => {
  it("renders byte-identical prompt output", () => {
    const input: ReviewPromptInput = {
      ...EXPLAIN_INPUT,
      markdown: "explanation\n\nsome markdown",
    };

    expect(buildReviewPrompt(input)).toBe(GOLDEN_REVIEW_DEFAULT);
  });
});

describe("buildReviewAmendPrompt", () => {
  it("renders byte-identical prompt output", () => {
    const issues: ReviewIssue[] = [
      { description: "too verbose" },
      { description: "missing diagram" },
    ];

    expect(buildReviewAmendPrompt(issues)).toBe(GOLDEN_REVIEW_AMEND);
  });
});
