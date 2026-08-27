import { describe, expect, it, vi } from "vitest";
import type { Category } from "../categories/types.js";
import type { ClassifiableChange } from "../classification/types.js";
import type { ClaudeProcessResult } from "../claude/exec.js";
import { createLogger } from "../logging/logger.js";
import { serializeSnippetRef } from "./markup.js";
import { MAX_REVIEW_ROUNDS, type ReviewLoopInput, reviewAndAmend } from "./review.js";

const CATEGORY: Category = { name: "Retry logic", description: "Adds backoff retries." };

const CHANGE: ClassifiableChange = {
  id: "c1",
  path: "src/fetch.ts",
  status: "modified",
  side: "head",
  range: { start: 10, end: 14 },
  excerpt: "+line",
};

const REF = serializeSnippetRef({
  path: "src/fetch.ts",
  side: "head",
  lines: { start: 10, end: 14 },
  unfold: true,
});

function baseInput(overrides: Partial<ReviewLoopInput> = {}): ReviewLoopInput {
  return {
    prTitle: "Add retry logic to the fetcher",
    prDescription: "Retries transient network failures with backoff.",
    category: CATEGORY,
    markdown: `explanation\n\n${REF}`,
    explainSessionId: "explain-session",
    changes: [CHANGE],
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

describe("reviewAndAmend", () => {
  it("returns the markdown unchanged when the first review approves", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ approved: true, issues: [] }, "review-1"),
    );

    const markdown = await reviewAndAmend(baseInput(), { runClaudeProcess });

    expect(markdown).toBe(`explanation\n\n${REF}`);
    expect(runClaudeProcess).toHaveBeenCalledTimes(1);
    const [args, prompt] = runClaudeProcess.mock.calls[0] ?? [];
    expect(prompt).toContain("Add retry logic to the fetcher");
    expect(prompt).toContain("Retry logic");
    expect((args as string[])[(args as string[]).indexOf("--model") + 1]).toBe("sonnet");
  });

  it("amends via the explaining session, re-checks coverage, then re-reviews with a fresh session", async () => {
    let call = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], input: string) => {
      call++;
      if (call === 1) {
        // First review: raises an issue.
        return envelope({ approved: false, issues: [{ description: "too verbose" }] }, "review-1");
      }
      if (call === 2) {
        // Amend, via the explaining session.
        expect(input).toContain("too verbose");
        return envelope({ markdown: `amended\n\n${REF}` }, "explain-session-2");
      }
      // Second review: approves.
      expect(input).toContain("amended");
      return envelope({ approved: true, issues: [] }, "review-2");
    });

    const markdown = await reviewAndAmend(baseInput(), { runClaudeProcess });

    expect(markdown).toBe(`amended\n\n${REF}`);
    expect(runClaudeProcess).toHaveBeenCalledTimes(3);
  });

  it("keeps the latest version and logs a warning after the review-round cap", async () => {
    let call = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) => {
      call++;
      if (call % 2 === 1) {
        return envelope(
          { approved: false, issues: [{ description: `issue ${call}` }] },
          `review-${call}`,
        );
      }
      return envelope({ markdown: `amended ${call}\n\n${REF}` }, `explain-session-${call}`);
    });
    const write = vi.fn();
    const logger = createLogger({ write });

    const markdown = await reviewAndAmend(baseInput(), { runClaudeProcess, logger });

    // MAX_REVIEW_ROUNDS reviews + (MAX_REVIEW_ROUNDS - 1) amendments.
    expect(runClaudeProcess).toHaveBeenCalledTimes(MAX_REVIEW_ROUNDS * 2 - 1);
    expect(markdown).toBe(`amended 4\n\n${REF}`);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toMatch(/warning.*Retry logic.*3 rounds/i);
  });
});
