import { describe, expect, it, vi } from "vitest";
import type { Category } from "../categories/types.js";
import { buildExcerpt } from "../classification/excerpt.js";
import type { ClassifiableChange } from "../classification/types.js";
import type { ClaudeProcessResult } from "../claude/exec.js";
import { config } from "../config.js";
import { explainCategory } from "./explain.js";
import type { ExplainCategoryInput } from "./types.js";

const MAX_EXCERPT_CHARS = config.limits.maxExcerptChars;

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

function baseInput(overrides: Partial<ExplainCategoryInput> = {}): ExplainCategoryInput {
  return {
    prTitle: "Add retry logic to the fetcher",
    prDescription: "Retries transient network failures with backoff.",
    category: CATEGORY,
    production: [change()],
    test: [change({ id: "c2", path: "src/fetch.test.ts", excerpt: "+test1", lines: ["+test1"] })],
    diffThreshold: 100,
    baseSha: "base-sha",
    headSha: "head-sha",
    ...overrides,
  };
}

function envelope(structuredOutput: unknown, sessionId = "session-1"): ClaudeProcessResult {
  return {
    stdout: JSON.stringify({
      result: "done",
      session_id: sessionId,
      structured_output: structuredOutput,
    }),
    stderr: "",
  };
}

describe("explainCategory", () => {
  it("sends the PR title/description, category, and both change sections", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ markdown: "# explanation" }),
    );

    await explainCategory(baseInput(), { runClaudeProcess });

    const [args, prompt] = runClaudeProcess.mock.calls[0] ?? [];
    expect(prompt).toContain("Add retry logic to the fetcher");
    expect(prompt).toContain("Retries transient network failures with backoff.");
    expect(prompt).toContain("Retry logic");
    expect(prompt).toContain("Adds backoff retries.");
    expect(prompt).toContain("Code and doc changes in this group");
    expect(prompt).toContain("Test changes in this group");
    expect(prompt).toContain("src/fetch.ts");
    expect(prompt).toContain("src/fetch.test.ts");
    expect(prompt).toMatch(/snippet/);
    expect(prompt).toMatch(/mermaid/);
    expect((args as string[])[(args as string[]).indexOf("--model") + 1]).toBe("opus");
  });

  it("tells the model docs live in the first (production) array and where they go", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ markdown: "# explanation" }),
    );

    await explainCategory(baseInput(), { runClaudeProcess });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).toMatch(/doc files, comments, and doc-strings.*go under "## Documentation"/i);
  });

  it("asks for conditional sections, not a fixed two-way split or a coverage strip", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ markdown: "# explanation" }),
    );

    await explainCategory(baseInput(), { runClaudeProcess });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    // The main section must be named for its content, not hardcoded as "production" — this is
    // what keeps a docs-only category from being mislabeled "## Production code".
    expect(prompt).toMatch(/name it for what it covers, not "production"/i);
    expect(prompt).toMatch(/## Documentation.*if any docs, comments, or doc-strings changed/i);
    expect(prompt).not.toMatch(/## Production code/);
    expect(prompt).not.toMatch(/omit whichever section has nothing to say/i);
    // The per-category "Coverage — Tests: ... · Docs: ..." strip is gone (docs/adr/0009): a
    // narrow category legitimately having no docs isn't a gap, and "Docs: none" read as one. The
    // conditional "## ..." sections above already convey presence without a misleading "none".
    expect(prompt).not.toMatch(/coverage strip/i);
    expect(prompt).not.toMatch(/Coverage — /);
  });

  it("drops the redundant documentation bullet from the production checklist", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ markdown: "# explanation" }),
    );

    await explainCategory(baseInput(), { runClaudeProcess });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    // Documentation is now its own conditional "## Documentation" section (asserted above); the
    // checklist bullet duplicating that is gone.
    expect(prompt).not.toMatch(/any documentation added or changed, and what kind/i);
  });

  it("tells the session its cwd is the head checkout, and gives both base/head SHAs", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ markdown: "# explanation" }),
    );

    await explainCategory(baseInput({ baseSha: "abc123base", headSha: "def456head" }), {
      runClaudeProcess,
    });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).toContain("abc123base");
    expect(prompt).toContain("def456head");
    expect(prompt).toMatch(/working directory is a checkout/);
    expect(prompt).toContain(".tulip/pr.diff");
    expect(prompt).toContain(".tulip/base");
    expect(prompt).toMatch(/removed\s+by the PR have no working-tree \(head\) copy/);
    // No Bash/git access is granted (see src/config.ts's claude.allowedTools doc comment) — the
    // prompt must not imply the session can run git commands itself.
    expect(prompt).not.toMatch(/git diff|git log|git blame|git show/);
  });

  it("includes the full diff for a change whose range is at or under the threshold", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ markdown: "# explanation" }),
    );

    // range is 10-12 (3 lines, from the `change()` helper's default) — under diffThreshold: 5.
    await explainCategory(
      baseInput({ production: [change({ lines: ["+kept line"] })], diffThreshold: 5 }),
      { runClaudeProcess },
    );

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).toContain("+kept line");
  });

  it("references only file/side/line-range when the true range exceeds the threshold, even if the diff itself is short", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ markdown: "# explanation" }),
    );
    // The diff is short, but the change's own line range (1-500) is what's measured against
    // the threshold — a short diff must not make a genuinely huge change look quotable.
    const shortLine = "+kept line";

    await explainCategory(
      baseInput({
        production: [change({ range: { start: 1, end: 500 }, lines: [shortLine] })],
        diffThreshold: 3,
      }),
      { runClaudeProcess },
    );

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).not.toContain(shortLine);
    expect(prompt).toContain("src/fetch.ts");
    expect(prompt).toContain("side head");
    expect(prompt).toContain("lines 1-500");
    expect(prompt).toMatch(/omitted/);
  });

  it("includes the full diff even when the classification excerpt was truncated, as long as the line count is under the threshold", async () => {
    // Regression test: formatChange must read from `change.lines` (the full diff), never from
    // `change.excerpt` — phase 2 truncates excerpts by character count (config.limits
    // .maxExcerptChars) for cheap classification prompts, which is unrelated to this
    // line-count threshold and must not cause an in-threshold change to be omitted here.
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ markdown: "# explanation" }),
    );
    const longLine = `+${"x".repeat(MAX_EXCERPT_CHARS)}`;
    const lines = [longLine, "+line2", "+line3"];
    const truncatedExcerpt = buildExcerpt({
      id: "c1",
      path: "src/fetch.ts",
      side: "head",
      range: { start: 10, end: 12 },
      lines,
    });
    expect(truncatedExcerpt).not.toBe(lines.join("\n")); // sanity: the excerpt really is truncated

    await explainCategory(
      // range is 10-12 (3 lines) — comfortably under diffThreshold: 1000.
      baseInput({
        production: [change({ excerpt: truncatedExcerpt, lines })],
        diffThreshold: 1000,
      }),
      { runClaudeProcess },
    );

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).toContain(longLine);
    expect(prompt).toContain("+line2");
    expect(prompt).toContain("+line3");
    expect(prompt).not.toMatch(/omitted/);
  });

  it("returns the markdown and session id", async () => {
    const runClaudeProcess = vi.fn(async () => envelope({ markdown: "# hello" }, "abc"));

    const result = await explainCategory(baseInput(), { runClaudeProcess });

    expect(result.markdown).toBe("# hello");
    expect(result.sessionId).toBe("abc");
  });
});
