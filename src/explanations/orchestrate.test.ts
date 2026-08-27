import { describe, expect, it, vi } from "vitest";
import type { Category } from "../categories/types.js";
import type { CategoryChangeSet } from "../classification/group.js";
import type { ClassifiableChange } from "../classification/types.js";
import type { ClaudeProcessResult } from "../claude/exec.js";
import { serializeSnippetRef } from "./markup.js";
import { type ExplainCategoriesInput, explainCategories } from "./orchestrate.js";

function envelope(structuredOutput: unknown, sessionId: string): ClaudeProcessResult {
  return {
    stdout: JSON.stringify({
      result: "done",
      session_id: sessionId,
      structured_output: structuredOutput,
    }),
    stderr: "",
  };
}

function change(id: string, path: string, range = { start: 1, end: 3 }): ClassifiableChange {
  return { id, path, status: "modified", side: "head", range, excerpt: "+line" };
}

function categorySet(
  category: Category,
  production: ClassifiableChange[],
  test: ClassifiableChange[],
): CategoryChangeSet {
  return { category, production, test };
}

function refFor(c: ClassifiableChange): string {
  return serializeSnippetRef({ path: c.path, side: c.side, lines: c.range, unfold: true });
}

describe("explainCategories", () => {
  it("returns one reviewed, coverage-verified explanation per category, in order", async () => {
    const categoryA: Category = { name: "A", description: "First category." };
    const categoryB: Category = { name: "B", description: "Second category." };
    const changeA = change("a1", "src/a.ts");
    const changeB = change("b1", "src/b.ts");
    const input: ExplainCategoriesInput = {
      prTitle: "Add retry logic",
      prDescription: "Retries transient failures.",
      diffThreshold: 100,
      categorySets: [categorySet(categoryA, [changeA], []), categorySet(categoryB, [changeB], [])],
    };

    const runClaudeProcess = vi.fn(async (_args: string[], promptText: string) => {
      // Distinguish explain calls (contain the category description) from reviews
      // (contain "Review it for") by the prompt content.
      if (promptText.includes("Review it for")) {
        return envelope({ approved: true, issues: [] }, "review-session");
      }
      const isA = promptText.includes("First category.");
      return envelope(
        { markdown: `explanation for ${isA ? "A" : "B"}\n\n${refFor(isA ? changeA : changeB)}` },
        "explain-session",
      );
    });

    const results = await explainCategories(input, { runClaudeProcess });

    expect(results).toHaveLength(2);
    expect(results[0]?.category).toBe(categoryA);
    expect(results[0]?.markdown).toContain("explanation for A");
    expect(results[1]?.category).toBe(categoryB);
    expect(results[1]?.markdown).toContain("explanation for B");
  });

  it("amends via snippet-coverage repair before review approves", async () => {
    const category: Category = { name: "Retry logic", description: "Adds backoff retries." };
    const production = [change("c1", "src/fetch.ts", { start: 10, end: 12 })];
    const test = [change("c2", "src/fetch.test.ts", { start: 1, end: 2 })];
    const input: ExplainCategoriesInput = {
      prTitle: "Add retry logic",
      prDescription: "Retries transient failures.",
      diffThreshold: 100,
      categorySets: [categorySet(category, production, test)],
    };

    let call = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], promptText: string) => {
      call++;
      if (call === 1) {
        // Initial explanation: references only the production change, not the test one.
        return envelope(
          { markdown: `explanation\n\n${refFor(production[0] as ClassifiableChange)}` },
          "explain-1",
        );
      }
      if (call === 2) {
        // Coverage repair: must be told about the missing test change.
        expect(promptText).toContain("src/fetch.test.ts");
        return envelope(
          {
            markdown: `explanation\n\n${refFor(production[0] as ClassifiableChange)}\n\n${refFor(test[0] as ClassifiableChange)}`,
          },
          "explain-2",
        );
      }
      // Review: approves.
      expect(promptText).toContain("Review it for");
      return envelope({ approved: true, issues: [] }, "review-1");
    });

    const results = await explainCategories(input, { runClaudeProcess });

    expect(runClaudeProcess).toHaveBeenCalledTimes(3);
    expect(results[0]?.markdown).toContain("src/fetch.ts");
    expect(results[0]?.markdown).toContain("src/fetch.test.ts");
  });

  it("processes categories concurrently, capped by the shared claude process limiter", async () => {
    const categories: CategoryChangeSet[] = Array.from({ length: 5 }, (_, i) =>
      categorySet(
        { name: `Category ${i}`, description: `Description ${i}` },
        [change(`c${i}`, `src/file${i}.ts`)],
        [],
      ),
    );
    const input: ExplainCategoriesInput = {
      prTitle: "Big PR",
      prDescription: "Many categories.",
      diffThreshold: 100,
      categorySets: categories,
    };

    let inFlight = 0;
    let peak = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], promptText: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;

      if (promptText.includes("Review it for")) {
        return envelope({ approved: true, issues: [] }, "review-session");
      }
      const match = /Category (\d+)/.exec(promptText);
      const ref = serializeSnippetRef({
        path: `src/file${match?.[1]}.ts`,
        side: "head",
        lines: { start: 1, end: 3 },
        unfold: true,
      });
      return envelope({ markdown: `explanation\n\n${ref}` }, "explain-session");
    });

    const results = await explainCategories(input, { runClaudeProcess });

    expect(results).toHaveLength(5);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBe(3); // 5 categories x 2 calls each, cap of 3, should actually be hit
  });
});
