import { describe, expect, it, vi } from "vitest";
import type { ClaudeProcessResult } from "../claude/exec.js";
import { createLogger } from "../logging/logger.js";
import { type CategoryReviewLoopInput, reviewAndAmendCategories } from "./review.js";
import type { Category, CategoryProposal } from "./types.js";

const CATEGORIES: Category[] = [
  { id: "c1", name: "Retry logic", description: "Adds backoff retries.", attention: "normal" },
  { id: "c2", name: "Wiring", description: "Plumbs config through.", attention: "skim" },
];

function baseInput(overrides: Partial<CategoryReviewLoopInput> = {}): CategoryReviewLoopInput {
  return {
    prTitle: "Add retry logic to the fetcher",
    prDescription: "Retries transient network failures with backoff.",
    files: [{ path: "src/fetch.ts", status: "modified" }],
    categories: CATEGORIES,
    generateSessionId: "generate-session",
    ...overrides,
  };
}

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

describe("reviewAndAmendCategories", () => {
  it("returns the category list unchanged when the first review approves", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ approved: true, issues: [] }, "review-1"),
    );

    const result = await reviewAndAmendCategories(baseInput(), { runClaudeProcess });

    expect(result.categories).toEqual(CATEGORIES);
    expect(result.sessionId).toBe("generate-session");
    expect(runClaudeProcess).toHaveBeenCalledTimes(1);
    const [args, prompt] = runClaudeProcess.mock.calls[0] ?? [];
    expect(prompt).toContain("Add retry logic to the fetcher");
    expect(prompt).toContain("Retry logic");
    expect((args as string[])[(args as string[]).indexOf("--model") + 1]).toBe("sonnet");
  });

  it("treats an approved:false reply with an empty issues list as approved", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ approved: false, issues: [] }, "review-1"),
    );

    const result = await reviewAndAmendCategories(baseInput(), { runClaudeProcess });

    expect(result.categories).toEqual(CATEGORIES);
    expect(runClaudeProcess).toHaveBeenCalledTimes(1);
  });

  it("gives the reviewer the PR title/description/file list, not a diff or excerpt", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ approved: true, issues: [] }, "review-1"),
    );

    await reviewAndAmendCategories(
      baseInput({ files: [{ path: "src/fetch.ts", status: "modified" }] }),
      { runClaudeProcess },
    );

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).toContain("src/fetch.ts (modified)");
    expect(prompt).not.toMatch(/diff|excerpt/i);
  });

  it("amends via the generating session and reassigns ids by attention, without re-reviewing", async () => {
    const revised: CategoryProposal[] = [
      { name: "Wiring", description: "Plumbs config through.", attention: "skim" },
      { name: "Retry logic", description: "Adds backoff retries.", attention: "close" },
    ];
    let call = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], input: string) => {
      call++;
      if (call === 1) {
        // Review: raises an issue.
        return envelope(
          { approved: false, issues: [{ description: "attention is inflated" }] },
          "review-1",
        );
      }
      // Amend, via the generating session.
      expect(input).toContain("attention is inflated");
      return envelope({ categories: revised }, "generate-session-2");
    });

    const result = await reviewAndAmendCategories(baseInput(), { runClaudeProcess });

    // Ids are reassigned by attention rank (close before skim — docs/adr/0005/0010), not the
    // model's emitted order (Wiring first, Retry logic second).
    expect(result.categories).toEqual([
      { id: "c1", name: "Retry logic", description: "Adds backoff retries.", attention: "close" },
      { id: "c2", name: "Wiring", description: "Plumbs config through.", attention: "skim" },
    ]);
    expect(result.sessionId).toBe("generate-session-2");
    // Review + amend only: the amended list is not reviewed again (docs/adr/0025).
    expect(runClaudeProcess).toHaveBeenCalledTimes(2);
    expect(runClaudeProcess.mock.calls[1]?.[0]).toContain("--resume");
  });

  it("skips the review for a single category", async () => {
    const runClaudeProcess = vi.fn();
    const write = vi.fn();
    const logger = createLogger({ write });
    const single = CATEGORIES.slice(0, 1);

    const result = await reviewAndAmendCategories(baseInput({ categories: single }), {
      runClaudeProcess,
      logger,
    });

    expect(result).toEqual({ categories: single, sessionId: "generate-session" });
    expect(runClaudeProcess).not.toHaveBeenCalled();
    expect(String(write.mock.calls[0]?.[0])).toMatch(/category review skipped/);
  });

  it("logs the review outcome at info level", async () => {
    let call = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) => {
      call++;
      if (call === 1) {
        return envelope(
          { approved: false, issues: [{ description: "too many groups" }] },
          "review-1",
        );
      }
      return envelope(
        { categories: [{ name: "Retry logic", description: "amended", attention: "normal" }] },
        "generate-session-2",
      );
    });
    const write = vi.fn();
    const logger = createLogger({ write });

    await reviewAndAmendCategories(baseInput(), { runClaudeProcess, logger });

    const lines = write.mock.calls.map((call) => String(call[0]));
    expect(lines).toEqual([
      expect.stringContaining("[INFO] category review: 1 issue(s), amending..."),
    ]);
  });

  it("rejects an empty amended category list", async () => {
    let call = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) => {
      call++;
      if (call === 1) {
        return envelope({ approved: false, issues: [{ description: "issue" }] }, "review-1");
      }
      return envelope({ categories: [] }, "generate-session-2");
    });

    await expect(reviewAndAmendCategories(baseInput(), { runClaudeProcess })).rejects.toThrow(
      "claude returned an empty amended category list",
    );
  });
});
