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
  changeOwners: new Map(),
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

  // Fold discipline & attention budget (docs/adr/0014): fold-by-default, the four named unfold
  // triggers, and the never-unfold list must survive in the rendered prompt.
  it("asks for fold-by-default with named unfold triggers, and never-unfolds facades/tests/generated files", () => {
    const prompt = buildExplainPrompt(EXPLAIN_INPUT);

    expect(prompt).toMatch(/Fold by default/i);
    expect(prompt).toMatch(/Write unfold="yes" ONLY when/i);
    expect(prompt).toMatch(/SMALL — the changed body is about ten lines or fewer/i);
    expect(prompt).toMatch(/SUBTLE — its logic is the thing to check/i);
    expect(prompt).toMatch(/HIDDEN EFFECT — the signature doesn't reveal/i);
    expect(prompt).toMatch(/CORE — the body is the primary logic/i);
    expect(prompt).toMatch(/"The whole thing is new" is not, by itself, a trigger/i);
    expect(prompt).toMatch(/Never unfold these/i);
    expect(prompt).toMatch(/pure-delegation facade whose methods only forward/i);
    expect(prompt).toMatch(/whole test file that verifies production code changed elsewhere/i);
    expect(prompt).toMatch(/generated files a tool emits and no one hand-edits/i);
    expect(prompt).toMatch(/Say each thing once within this explanation/i);
    expect(prompt).toMatch(/The attention rating is your budget/i);
  });

  it("annotates a secondary change with its owner and a catref backlink, but not a primary one", () => {
    const input: ExplainCategoryInput = {
      ...EXPLAIN_INPUT,
      production: [
        change(),
        change({ id: "shared", path: "src/shared.ts", excerpt: "+s", lines: ["+s"] }),
      ],
      test: [],
      // "c1" is primary here (owned by this category "c1"); "shared" is owned by another.
      changeOwners: new Map([
        ["c1", { ownerCategoryId: "c1", ownerTitle: "Retry logic" }],
        ["shared", { ownerCategoryId: "c3", ownerTitle: "Shared helpers" }],
      ]),
    };

    const prompt = buildExplainPrompt(input);

    // The secondary change carries the reference-only annotation and an attributed catref.
    expect(prompt).toContain('already explained under "Shared helpers"');
    expect(prompt).toContain('{{catref id="c3"}}');
    // The primary change (src/fetch.ts) is not annotated.
    expect(prompt).toMatch(/src\/fetch\.ts \(modified\), side head, lines 10-12\n/);
    expect(prompt).not.toMatch(/src\/fetch\.ts.*already explained under/);
  });

  it("renders the category's attention label into the prompt", () => {
    const closeInput: ExplainCategoryInput = {
      ...EXPLAIN_INPUT,
      category: { ...CATEGORY, attention: "close" },
    };
    const skimInput: ExplainCategoryInput = {
      ...EXPLAIN_INPUT,
      category: { ...CATEGORY, attention: "skim" },
    };

    expect(buildExplainPrompt(closeInput)).toContain("Attention rating: Read closely");
    expect(buildExplainPrompt(skimInput)).toContain("Attention rating: Skim");
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

  it("asks the reviewer to check conciseness and minimalism — no over-explaining the obvious or belaboring boilerplate", () => {
    const input: ReviewPromptInput = {
      ...EXPLAIN_INPUT,
      markdown: "explanation\n\nsome markdown",
    };

    const prompt = buildReviewPrompt(input);

    expect(prompt).toMatch(/conciseness and minimalism/i);
    expect(prompt).toMatch(/over-explaining the obvious/i);
    expect(prompt).toMatch(/restating what the code plainly shows/i);
    expect(prompt).toMatch(/trivial or boilerplate/i);
    expect(prompt).toMatch(/every\s+sentence should earn its place/i);
    expect(prompt).toMatch(/padding, redundancy, and belaboring/i);
  });

  // Fold discipline & attention budget (docs/adr/0014): the merged review-time check.
  it("asks the reviewer to check fold discipline against the category's attention budget", () => {
    const input: ReviewPromptInput = {
      ...EXPLAIN_INPUT,
      markdown: "explanation\n\nsome markdown",
    };

    const prompt = buildReviewPrompt(input);

    expect(prompt).toMatch(/fold discipline & attention budget/i);
    expect(prompt).toMatch(/folded \(unfold="no"\) is the default/i);
    expect(prompt).toMatch(/forwarding facade methods/i);
    expect(prompt).toMatch(/whole test files \(unless the tests are this category's subject\)/i);
    expect(prompt).toMatch(/Match depth to this category's rating\s*\(Read through\)/i);
    expect(prompt).toMatch(/Don't flag a correctly-unfolded SMALL, SUBTLE, or CORE body/i);
    expect(prompt).toMatch(/trivial change earns a proportionate phrase/i);
    expect(prompt).toMatch(/no duplication — flag a fact restated elsewhere/i);
  });

  it("renders the category's attention label into the prompt", () => {
    const closeInput: ReviewPromptInput = {
      ...EXPLAIN_INPUT,
      category: { ...CATEGORY, attention: "close" },
      markdown: "explanation",
    };
    const skimInput: ReviewPromptInput = {
      ...EXPLAIN_INPUT,
      category: { ...CATEGORY, attention: "skim" },
      markdown: "explanation",
    };

    expect(buildReviewPrompt(closeInput)).toContain("Attention rating: Read closely");
    expect(buildReviewPrompt(skimInput)).toContain("Attention rating: Skim");
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
