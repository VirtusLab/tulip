import { describe, expect, it, vi } from "vitest";
import type { Category } from "../categories/types.js";
import type { CategoryChangeSet } from "../classification/group.js";
import type { ClassifiableChange } from "../classification/types.js";
import type { ClaudeProcessResult } from "../claude/exec.js";
import { serializeSnippetRef } from "./markup.js";
import {
  CategoryExplanationError,
  ExplainCategoriesError,
  type ExplainCategoriesInput,
  explainCategories,
} from "./orchestrate.js";

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
  return { id, path, status: "modified", side: "head", range, excerpt: "+line", lines: ["+line"] };
}

function categorySet(
  category: Category,
  production: ClassifiableChange[],
  test: ClassifiableChange[],
): CategoryChangeSet {
  return {
    category,
    production,
    test,
    primaryChangeIds: new Set([...production, ...test].map((c) => c.id)),
  };
}

function refFor(c: ClassifiableChange): string {
  return serializeSnippetRef({ path: c.path, side: c.side, lines: c.range, unfold: true });
}

describe("explainCategories", () => {
  it("returns one reviewed, coverage-verified explanation per category, in order", async () => {
    const categoryA: Category = {
      id: "c1",
      name: "A",
      description: "First category.",
      attention: "normal",
    };
    const categoryB: Category = {
      id: "c2",
      name: "B",
      description: "Second category.",
      attention: "normal",
    };
    const changeA = change("a1", "src/a.ts");
    const changeB = change("b1", "src/b.ts");
    const input: ExplainCategoriesInput = {
      prTitle: "Add retry logic",
      prDescription: "Retries transient failures.",
      diffThreshold: 100,
      baseSha: "base-sha",
      headSha: "head-sha",
      categorySets: [categorySet(categoryA, [changeA], []), categorySet(categoryB, [changeB], [])],
    };

    const runClaudeProcess = vi.fn(async (_args: string[], promptText: string) => {
      // Distinguish explain calls (contain the category description) from reviews
      // (contain "Reply with approved") by the prompt content.
      if (promptText.includes("Reply with approved")) {
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
    const category: Category = {
      id: "c1",
      name: "Retry logic",
      description: "Adds backoff retries.",
      attention: "normal",
    };
    const production = [change("c1", "src/fetch.ts", { start: 10, end: 12 })];
    const test = [change("c2", "src/fetch.test.ts", { start: 1, end: 2 })];
    const input: ExplainCategoriesInput = {
      prTitle: "Add retry logic",
      prDescription: "Retries transient failures.",
      diffThreshold: 100,
      baseSha: "base-sha",
      headSha: "head-sha",
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
      expect(promptText).toContain("Reply with approved");
      return envelope({ approved: true, issues: [] }, "review-1");
    });

    const results = await explainCategories(input, { runClaudeProcess });

    expect(runClaudeProcess).toHaveBeenCalledTimes(3);
    expect(results[0]?.markdown).toContain("src/fetch.ts");
    expect(results[0]?.markdown).toContain("src/fetch.test.ts");
  });

  it("does not require a snippet for a secondary (non-primary) change", async () => {
    // The change is in the category's production list but not its `primaryChangeIds` — owned by
    // an earlier category (docs/adr/0015). Coverage must pass with no snippet for it; the
    // explanation only mentions it. Two claude calls total (explain + review), no coverage repair.
    const category: Category = {
      id: "c2",
      name: "Secondary",
      description: "Only secondary changes.",
      attention: "normal",
    };
    const secondary = change("shared", "src/shared.ts");
    const input: ExplainCategoriesInput = {
      prTitle: "Add retry logic",
      prDescription: "Retries transient failures.",
      diffThreshold: 100,
      baseSha: "base-sha",
      headSha: "head-sha",
      categorySets: [
        {
          category,
          production: [secondary],
          test: [],
          primaryChangeIds: new Set<string>(),
        },
      ],
    };

    const runClaudeProcess = vi.fn(async (_args: string[], promptText: string) => {
      if (promptText.includes("Reply with approved")) {
        return envelope({ approved: true, issues: [] }, "review-session");
      }
      // No snippet ref at all — just prose backlinking elsewhere.
      return envelope({ markdown: "explained under another category" }, "explain-session");
    });

    const results = await explainCategories(input, { runClaudeProcess });

    expect(results).toHaveLength(1);
    expect(runClaudeProcess).toHaveBeenCalledTimes(2);
  });

  // A realistic LLM slip (mismatched node-shape delimiters), matching the real "Syntax error in
  // text" a user hit in the browser — see docs/adr/0008.
  const INVALID_DIAGRAM = "graph TD\nA[Start --> B{Decision\nB -->|Yes] C[End]";
  const FIXED_DIAGRAM = "graph TD\nA --> B";

  function withInvalidDiagram(body: string): string {
    return `${body}\n\n\`\`\`mermaid\n${INVALID_DIAGRAM}\n\`\`\``;
  }

  it("wires mermaid verification into the flow: a fixable diagram ends up valid in the final markdown", async () => {
    const category: Category = {
      id: "c1",
      name: "Diagrammed",
      description: "Has a diagram.",
      attention: "normal",
    };
    const production = [change("c1", "src/diagram.ts")];
    const input: ExplainCategoriesInput = {
      prTitle: "Add a diagram",
      prDescription: "Illustrates the flow.",
      diffThreshold: 100,
      baseSha: "base-sha",
      headSha: "head-sha",
      categorySets: [categorySet(category, production, [])],
    };

    const runClaudeProcess = vi.fn(async (_args: string[], promptText: string) => {
      if (promptText.includes("Reply with approved")) {
        return envelope({ approved: true, issues: [] }, "review-session");
      }
      if (promptText.includes("corrected Mermaid diagram source")) {
        expect(promptText).toContain(INVALID_DIAGRAM);
        return envelope({ source: FIXED_DIAGRAM }, "explain-session-2");
      }
      return envelope(
        {
          markdown: withInvalidDiagram(
            `explanation\n\n${refFor(production[0] as ClassifiableChange)}`,
          ),
        },
        "explain-session-1",
      );
    });

    const results = await explainCategories(input, { runClaudeProcess });

    expect(results[0]?.markdown).toContain(FIXED_DIAGRAM);
    expect(results[0]?.markdown).not.toContain(INVALID_DIAGRAM);
  });

  it("wires mermaid verification into the flow: a diagram still invalid after every fix attempt is omitted, not shipped broken", async () => {
    const category: Category = {
      id: "c1",
      name: "Diagrammed",
      description: "Has a diagram.",
      attention: "normal",
    };
    const production = [change("c1", "src/diagram.ts")];
    const input: ExplainCategoriesInput = {
      prTitle: "Add a diagram",
      prDescription: "Illustrates the flow.",
      diffThreshold: 100,
      baseSha: "base-sha",
      headSha: "head-sha",
      categorySets: [categorySet(category, production, [])],
    };

    const runClaudeProcess = vi.fn(async (_args: string[], promptText: string) => {
      if (promptText.includes("Reply with approved")) {
        return envelope({ approved: true, issues: [] }, "review-session");
      }
      if (promptText.includes("corrected Mermaid diagram source")) {
        // The "fix" is still invalid, every attempt.
        return envelope({ source: "still [[[ broken" }, "explain-session-fix");
      }
      return envelope(
        {
          markdown: withInvalidDiagram(
            `explanation\n\n${refFor(production[0] as ClassifiableChange)}`,
          ),
        },
        "explain-session-1",
      );
    });

    const results = await explainCategories(input, { runClaudeProcess });

    expect(results[0]?.markdown).not.toContain("```mermaid");
    expect(results[0]?.markdown).not.toContain(INVALID_DIAGRAM);
    expect(results[0]?.markdown).toContain("omitted");
  });

  it("processes categories concurrently, capped by the shared claude process limiter", async () => {
    const categories: CategoryChangeSet[] = Array.from({ length: 5 }, (_, i) =>
      categorySet(
        { id: "c1", name: `Category ${i}`, description: `Description ${i}`, attention: "normal" },
        [change(`c${i}`, `src/file${i}.ts`)],
        [],
      ),
    );
    const input: ExplainCategoriesInput = {
      prTitle: "Big PR",
      prDescription: "Many categories.",
      diffThreshold: 100,
      baseSha: "base-sha",
      headSha: "head-sha",
      categorySets: categories,
    };

    let inFlight = 0;
    let peak = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], promptText: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;

      if (promptText.includes("Reply with approved")) {
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

  it("logs when each category's explanation starts and finishes", async () => {
    const categoryA: Category = {
      id: "c1",
      name: "A",
      description: "First category.",
      attention: "normal",
    };
    const categoryB: Category = {
      id: "c2",
      name: "B",
      description: "Second category.",
      attention: "normal",
    };
    const input: ExplainCategoriesInput = {
      prTitle: "Add retry logic",
      prDescription: "Retries transient failures.",
      diffThreshold: 100,
      baseSha: "base-sha",
      headSha: "head-sha",
      categorySets: [
        categorySet(categoryA, [change("a1", "src/a.ts")], []),
        categorySet(categoryB, [change("b1", "src/b.ts")], []),
      ],
    };
    const runClaudeProcess = vi.fn(async (_args: string[], promptText: string) => {
      if (promptText.includes("Reply with approved")) {
        return envelope({ approved: true, issues: [] }, "review-session");
      }
      const isA = promptText.includes("First category.");
      return envelope(
        {
          markdown: `explanation\n\n${refFor(isA ? change("a1", "src/a.ts") : change("b1", "src/b.ts"))}`,
        },
        "explain-session",
      );
    });
    const info = vi.fn();

    await explainCategories(input, { runClaudeProcess, logger: { info, debug: vi.fn() } });

    const lines = info.mock.calls.map((call) => String(call[0]));
    expect(lines).toContain('explaining category "A"...');
    expect(lines).toContain('finished explaining category "A"');
    expect(lines).toContain('explaining category "B"...');
    expect(lines).toContain('finished explaining category "B"');
  });

  it("attributes a failure to its category and doesn't hide a concurrent failure in another", async () => {
    const categoryA: Category = {
      id: "c1",
      name: "A",
      description: "First category.",
      attention: "normal",
    };
    const categoryB: Category = {
      id: "c2",
      name: "B",
      description: "Second category.",
      attention: "normal",
    };
    const input: ExplainCategoriesInput = {
      prTitle: "Add retry logic",
      prDescription: "Retries transient failures.",
      diffThreshold: 100,
      baseSha: "base-sha",
      headSha: "head-sha",
      categorySets: [
        categorySet(categoryA, [change("a1", "src/a.ts")], []),
        categorySet(categoryB, [change("b1", "src/b.ts")], []),
      ],
    };
    const runClaudeProcess = vi.fn(async (_args: string[], promptText: string) => {
      if (promptText.includes("First category.")) {
        throw new Error("boom A");
      }
      if (promptText.includes("Second category.")) {
        throw new Error("boom B");
      }
      return envelope({ approved: true, issues: [] }, "review-session");
    });

    const error = await explainCategories(input, { runClaudeProcess }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ExplainCategoriesError);
    const explainError = error as ExplainCategoriesError;
    expect(explainError.failures).toHaveLength(2);
    expect(explainError.failures.every((f) => f instanceof CategoryExplanationError)).toBe(true);
    expect(explainError.failures.map((f) => f.categoryName).sort()).toEqual(["A", "B"]);
    expect(explainError.message).toContain('category "A": ');
    expect(explainError.message).toContain("boom A");
    expect(explainError.message).toContain('category "B": ');
    expect(explainError.message).toContain("boom B");
    expect(explainError.message).toContain("2 of 2 categories failed");
  });

  it("drops a category with no production and no test changes before phase 3, and logs it", async () => {
    const categoryA: Category = {
      id: "c1",
      name: "A",
      description: "First category.",
      attention: "normal",
    };
    const categoryEmpty: Category = {
      id: "c2",
      name: "Empty",
      description: "Nothing here.",
      attention: "normal",
    };
    const input: ExplainCategoriesInput = {
      prTitle: "Add retry logic",
      prDescription: "Retries transient failures.",
      diffThreshold: 100,
      baseSha: "base-sha",
      headSha: "head-sha",
      categorySets: [
        categorySet(categoryA, [change("a1", "src/a.ts")], []),
        categorySet(categoryEmpty, [], []),
      ],
    };
    const runClaudeProcess = vi.fn(async (_args: string[], promptText: string) => {
      if (promptText.includes("Reply with approved")) {
        return envelope({ approved: true, issues: [] }, "review-session");
      }
      return envelope(
        { markdown: `explanation\n\n${refFor(change("a1", "src/a.ts"))}` },
        "explain-session",
      );
    });
    const info = vi.fn();

    const results = await explainCategories(input, {
      runClaudeProcess,
      logger: { info, debug: vi.fn() },
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.category).toBe(categoryA);
    const lines = info.mock.calls.map((call) => String(call[0]));
    expect(
      lines.some((line) => line.includes("dropping 1 category") && line.includes("Empty")),
    ).toBe(true);
    expect(lines.some((line) => line.includes('explaining category "Empty"'))).toBe(false);
  });

  it("only reports the failed category, not a category that succeeded", async () => {
    const categoryA: Category = {
      id: "c1",
      name: "A",
      description: "First category.",
      attention: "normal",
    };
    const categoryB: Category = {
      id: "c2",
      name: "B",
      description: "Second category.",
      attention: "normal",
    };
    const input: ExplainCategoriesInput = {
      prTitle: "Add retry logic",
      prDescription: "Retries transient failures.",
      diffThreshold: 100,
      baseSha: "base-sha",
      headSha: "head-sha",
      categorySets: [
        categorySet(categoryA, [change("a1", "src/a.ts")], []),
        categorySet(categoryB, [change("b1", "src/b.ts")], []),
      ],
    };
    const runClaudeProcess = vi.fn(async (_args: string[], promptText: string) => {
      if (promptText.includes("First category.")) {
        throw new Error("boom A");
      }
      if (promptText.includes("Reply with approved")) {
        return envelope({ approved: true, issues: [] }, "review-session");
      }
      return envelope(
        { markdown: `explanation\n\n${refFor(change("b1", "src/b.ts"))}` },
        "explain-session",
      );
    });

    const error = (await explainCategories(input, { runClaudeProcess }).catch(
      (e: unknown) => e,
    )) as ExplainCategoriesError;

    expect(error.failures).toHaveLength(1);
    expect(error.failures[0]?.categoryName).toBe("A");
    expect(error.message).toContain("1 of 2 categories failed");
  });
});
