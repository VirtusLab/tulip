import { describe, expect, it } from "vitest";
import type { Category } from "../categories/types.js";
import type { ClassifiableChange } from "../classification/types.js";
import {
  buildCoverageAmendPrompt,
  buildExplainPrompt,
  buildMermaidFixPrompt,
  buildReviewAmendPrompt,
  buildReviewPrompt,
} from "./prompt.js";
import type { ExplainCategoryInput, ReviewIssue, ReviewPromptInput } from "./types.js";

const CATEGORY: Category = {
  id: "c1",
  name: "Retry logic",
  description: "Adds backoff retries.",
  attention: "normal",
};

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
// the OLD template-literal builder's output for the same inputs. Each case is checked against a
// committed file snapshot (src/explanations/__snapshots__/*.txt) — run `vitest -u` to
// regenerate after a deliberate .md wording change.
describe("buildExplainPrompt", () => {
  it("renders byte-identical prompt output", async () => {
    await expect(buildExplainPrompt(EXPLAIN_INPUT)).toMatchFileSnapshot(
      "__snapshots__/explain-default.txt",
    );
  });

  it("renders byte-identical prompt output when a change's range is over the diff threshold", async () => {
    const input: ExplainCategoryInput = {
      ...EXPLAIN_INPUT,
      production: [change({ range: { start: 1, end: 500 } })],
      diffThreshold: 3,
    };

    await expect(buildExplainPrompt(input)).toMatchFileSnapshot(
      "__snapshots__/explain-over-threshold.txt",
    );
  });

  it("renders byte-identical prompt output with an empty test-changes list", async () => {
    const input: ExplainCategoryInput = { ...EXPLAIN_INPUT, test: [] };

    await expect(buildExplainPrompt(input)).toMatchFileSnapshot(
      "__snapshots__/explain-empty-test-list.txt",
    );
  });
});

describe("buildCoverageAmendPrompt", () => {
  it("renders byte-identical prompt output", async () => {
    const missing = [change(), change({ id: "c2", path: "src/fetch.test.ts" })];

    await expect(buildCoverageAmendPrompt(missing)).toMatchFileSnapshot(
      "__snapshots__/coverage-amend.txt",
    );
  });
});

describe("buildReviewPrompt", () => {
  it("renders byte-identical prompt output", async () => {
    const input: ReviewPromptInput = {
      ...EXPLAIN_INPUT,
      markdown: "explanation\n\nsome markdown",
    };

    await expect(buildReviewPrompt(input)).toMatchFileSnapshot("__snapshots__/review-default.txt");
  });
});

describe("buildReviewAmendPrompt", () => {
  it("renders byte-identical prompt output", async () => {
    const issues: ReviewIssue[] = [
      { description: "too verbose" },
      { description: "missing diagram" },
    ];

    await expect(buildReviewAmendPrompt(issues)).toMatchFileSnapshot(
      "__snapshots__/review-amend.txt",
    );
  });
});

// New prompt (docs/adr/0008) — no prior template-literal to byte-match, so this is a plain
// content assertion rather than the migration-guard file-snapshot pattern used above.
describe("buildMermaidFixPrompt", () => {
  it("includes the invalid source and the parser's error", () => {
    const prompt = buildMermaidFixPrompt("graph TD\nA[Bad", "Parse error on line 2");

    expect(prompt).toContain("graph TD\nA[Bad");
    expect(prompt).toContain("Parse error on line 2");
    expect(prompt).toMatch(/corrected Mermaid diagram source/i);
  });
});
