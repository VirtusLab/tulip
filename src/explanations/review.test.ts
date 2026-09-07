import { describe, expect, it, vi } from "vitest";
import type { Category } from "../categories/types.js";
import type { ClassifiableChange } from "../classification/types.js";
import type { ClaudeProcessResult } from "../claude/exec.js";
import { config } from "../config.js";
import { createLogger } from "../logging/logger.js";
import { serializeSnippetRef } from "./markup.js";
import { type ReviewLoopInput, reviewAndAmend } from "./review.js";

const MAX_REVIEW_ROUNDS = config.limits.maxReviewRounds;

const CATEGORY: Category = {
  id: "c1",
  name: "Retry logic",
  description: "Adds backoff retries.",
  attention: "normal",
};

const CHANGE: ClassifiableChange = {
  id: "c1",
  path: "src/fetch.ts",
  status: "modified",
  side: "head",
  range: { start: 10, end: 14 },
  excerpt: "+line",
  lines: ["+line"],
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
    production: [CHANGE],
    test: [],
    primaryChangeIds: new Set(["c1"]),
    changeOwners: new Map(),
    diffThreshold: 100,
    baseSha: "base-sha",
    headSha: "head-sha",
    markdown: `explanation\n\n${REF}`,
    explainSessionId: "explain-session",
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

    const result = await reviewAndAmend(baseInput(), { runClaudeProcess });

    expect(result.markdown).toBe(`explanation\n\n${REF}`);
    expect(result.explainSessionId).toBe("explain-session");
    expect(runClaudeProcess).toHaveBeenCalledTimes(1);
    const [args, prompt] = runClaudeProcess.mock.calls[0] ?? [];
    expect(prompt).toContain("Add retry logic to the fetcher");
    expect(prompt).toContain("Retry logic");
    expect((args as string[])[(args as string[]).indexOf("--model") + 1]).toBe("sonnet");
  });

  it("tells the reviewer its working directory is the head checkout, and gives both SHAs", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ approved: true, issues: [] }, "review-1"),
    );

    await reviewAndAmend(baseInput(), { runClaudeProcess });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).toContain("base-sha");
    expect(prompt).toContain("head-sha");
    expect(prompt).toMatch(/working directory is a checkout/);
    expect(prompt).toContain(".tulip/pr.diff");
    expect(prompt).toContain(".tulip/base");
    expect(prompt).toMatch(/removed\s+by the PR have no working-tree \(head\) copy/);
    // No Bash/git access is granted (see src/config.ts's claude.allowedTools doc comment) — the
    // prompt must not imply the session can run git commands itself.
    expect(prompt).not.toMatch(/git diff|git log|git blame|git show/);
  });

  it("gives the reviewer the same changes the explaining session got", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ approved: true, issues: [] }, "review-1"),
    );

    await reviewAndAmend(
      baseInput({
        production: [CHANGE],
        test: [{ ...CHANGE, id: "c2", path: "src/fetch.test.ts" }],
      }),
      { runClaudeProcess },
    );

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).toContain("Code and doc changes in this group");
    expect(prompt).toContain("Test changes in this group");
    expect(prompt).toContain("src/fetch.ts");
    expect(prompt).toContain("src/fetch.test.ts");
    expect(prompt).toMatch(/match the changes/);
  });

  // The per-category "Coverage — Tests: ... · Docs: ..." strip is gone (docs/adr/0009), so the
  // review checklist no longer asks about it.
  it("doesn't ask the reviewer to check a coverage strip", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ approved: true, issues: [] }, "review-1"),
    );

    await reviewAndAmend(baseInput(), { runClaudeProcess });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).not.toMatch(/coverage strip/i);
    expect(prompt).not.toMatch(/Coverage — /);
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

    const result = await reviewAndAmend(baseInput(), { runClaudeProcess });

    expect(result.markdown).toBe(`amended\n\n${REF}`);
    expect(result.explainSessionId).toBe("explain-session-2");
    expect(runClaudeProcess).toHaveBeenCalledTimes(3);
  });

  it("does not re-impose snippet coverage on a secondary change after an amend", async () => {
    // The change is secondary here (empty `primaryChangeIds`), so the post-amend coverage check
    // must not force a snippet for it — even though the amended markdown drops every ref
    // (docs/adr/0015: relaxing only the initial explain would let an amend round re-force it).
    let call = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], input: string) => {
      call++;
      if (call === 1) {
        return envelope({ approved: false, issues: [{ description: "reword it" }] }, "review-1");
      }
      if (call === 2) {
        // Amend drops the snippet entirely; coverage must still accept it.
        return envelope({ markdown: "amended, no snippet" }, "explain-session-2");
      }
      expect(input).toContain("amended, no snippet");
      return envelope({ approved: true, issues: [] }, "review-2");
    });

    const result = await reviewAndAmend(baseInput({ primaryChangeIds: new Set<string>() }), {
      runClaudeProcess,
    });

    // Exactly review, amend, review — no coverage-repair resume in between.
    expect(runClaudeProcess).toHaveBeenCalledTimes(3);
    expect(result.markdown).toBe("amended, no snippet");
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

    const result = await reviewAndAmend(baseInput(), { runClaudeProcess, logger });

    // MAX_REVIEW_ROUNDS reviews + (MAX_REVIEW_ROUNDS - 1) amendments.
    expect(runClaudeProcess).toHaveBeenCalledTimes(MAX_REVIEW_ROUNDS * 2 - 1);
    expect(result.markdown).toBe(`amended 4\n\n${REF}`);
    expect(result.explainSessionId).toBe("explain-session-4");
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toMatch(/warning.*Retry logic.*3 rounds/i);
  });

  it("logs each review round at debug level when verbose", async () => {
    let call = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) => {
      call++;
      if (call === 1) {
        return envelope({ approved: false, issues: [{ description: "too verbose" }] }, "review-1");
      }
      if (call === 2) {
        return envelope({ markdown: `amended\n\n${REF}` }, "explain-session-2");
      }
      return envelope({ approved: true, issues: [] }, "review-2");
    });
    const write = vi.fn();
    const logger = createLogger({ write, verbose: true });

    await reviewAndAmend(baseInput(), { runClaudeProcess, logger });

    const debugLines = write.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("[DEBUG]"));
    expect(debugLines).toContainEqual(
      expect.stringContaining('category "Retry logic": review round 1/3'),
    );
    expect(debugLines).toContainEqual(
      expect.stringContaining('category "Retry logic": review round 2/3'),
    );
  });
});
