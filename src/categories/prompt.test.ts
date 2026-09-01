import { describe, expect, it } from "vitest";
import { buildCategoryReviewAmendPrompt, buildCategoryReviewPrompt } from "./prompt.js";
import type { Category, ReviewIssue } from "./types.js";

const CATEGORIES: Category[] = [
  { id: "c1", name: "Retry logic", description: "Adds backoff retries.", attention: "close" },
  {
    id: "c2",
    name: "Config wiring",
    description: "Plumbs the new option through.",
    attention: "skim",
  },
];

describe("buildCategoryReviewPrompt", () => {
  it("renders byte-identical prompt output", async () => {
    const prompt = buildCategoryReviewPrompt({
      prTitle: "Add retry logic to the fetcher",
      prDescription: "Retries transient network failures with backoff.",
      files: [
        { path: "src/fetch.ts", status: "modified" },
        { path: "src/fetch.test.ts", status: "modified" },
      ],
      categories: CATEGORIES,
    });

    await expect(prompt).toMatchFileSnapshot("__snapshots__/category-review-default.txt");
  });

  it("renders byte-identical prompt output for an empty/whitespace description", async () => {
    const prompt = buildCategoryReviewPrompt({
      prTitle: "Trivial fix",
      prDescription: "   ",
      files: [{ path: "src/a.ts", status: "added" }],
      categories: [
        { id: "c1", name: "Trivial fix", description: "Fixes a typo.", attention: "normal" },
      ],
    });

    await expect(prompt).toMatchFileSnapshot("__snapshots__/category-review-empty-description.txt");
  });

  it("gives the reviewer the same title/description/file list phase 1 got, and no diffs", () => {
    const prompt = buildCategoryReviewPrompt({
      prTitle: "Add retry logic to the fetcher",
      prDescription: "Retries transient network failures with backoff.",
      files: [{ path: "src/fetch.ts", status: "modified" }],
      categories: CATEGORIES,
    });

    expect(prompt).toContain("Add retry logic to the fetcher");
    expect(prompt).toContain("Retries transient network failures with backoff.");
    expect(prompt).toContain("src/fetch.ts (modified)");
    expect(prompt).not.toMatch(/diff|excerpt/i);
  });

  it("lists each proposed category with its name, description, and attention label", () => {
    const prompt = buildCategoryReviewPrompt({
      prTitle: "Add retry logic to the fetcher",
      prDescription: "Retries transient network failures with backoff.",
      files: [{ path: "src/fetch.ts", status: "modified" }],
      categories: CATEGORIES,
    });

    expect(prompt).toContain("Retry logic (Read closely): Adds backoff retries.");
    expect(prompt).toContain("Config wiring (Skim): Plumbs the new option through.");
  });

  it("states the review criteria: self-containment, granularity, no tests/docs category, sensible attention", () => {
    const prompt = buildCategoryReviewPrompt({
      prTitle: "Add retry logic to the fetcher",
      prDescription: "Retries transient network failures with backoff.",
      files: [{ path: "src/fetch.ts", status: "modified" }],
      categories: CATEGORIES,
    });

    expect(prompt).toMatch(/self-contained concern/i);
    expect(prompt).toMatch(/one thing at a time/i);
    expect(prompt).toMatch(/not\s+fragmented into trivia/i);
    expect(prompt).toMatch(/cross-cutting concern/i);
    expect(prompt).toMatch(/standalone\s+"tests" or "documentation" category/i);
    expect(prompt).toMatch(/inflated spread/i);
    expect(prompt).toMatch(/rated Skim/i);
    expect(prompt).toMatch(/never look like it changed how\s+the PR was split/i);
  });
});

describe("buildCategoryReviewAmendPrompt", () => {
  it("renders byte-identical prompt output", async () => {
    const issues: ReviewIssue[] = [
      { description: "Retry logic and config wiring should be one category" },
      { description: "Config wiring is core work, not skim-worthy" },
    ];

    await expect(buildCategoryReviewAmendPrompt(issues)).toMatchFileSnapshot(
      "__snapshots__/category-review-amend.txt",
    );
  });

  it("asks for the full revised list, not just the changed categories", () => {
    const prompt = buildCategoryReviewAmendPrompt([{ description: "issue" }]);

    expect(prompt).toMatch(/full, revised category list/i);
    expect(prompt).toMatch(/every category,\s*\n?\s*not just the ones that changed/i);
  });
});
