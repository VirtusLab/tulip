import { describe, expect, it, vi } from "vitest";
import type { Category } from "../categories/types.js";
import type { ClassifiableChange } from "../classification/types.js";
import type { ClaudeProcessResult } from "../claude/exec.js";
import { explainCategory } from "./explain.js";
import type { ExplainCategoryInput } from "./types.js";

const CATEGORY: Category = { name: "Retry logic", description: "Adds backoff retries." };

function change(overrides: Partial<ClassifiableChange> = {}): ClassifiableChange {
  return {
    id: "c1",
    path: "src/fetch.ts",
    status: "modified",
    side: "head",
    range: { start: 10, end: 12 },
    excerpt: "+line1\n+line2\n+line3",
    ...overrides,
  };
}

function baseInput(overrides: Partial<ExplainCategoryInput> = {}): ExplainCategoryInput {
  return {
    prTitle: "Add retry logic to the fetcher",
    prDescription: "Retries transient network failures with backoff.",
    category: CATEGORY,
    production: [change()],
    test: [change({ id: "c2", path: "src/fetch.test.ts", excerpt: "+test1" })],
    diffThreshold: 100,
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
    expect(prompt).toContain("Production code changes");
    expect(prompt).toContain("Test code changes");
    expect(prompt).toContain("src/fetch.ts");
    expect(prompt).toContain("src/fetch.test.ts");
    expect(prompt).toMatch(/snippet/);
    expect(prompt).toMatch(/mermaid/);
    expect((args as string[])[(args as string[]).indexOf("--model") + 1]).toBe("opus");
  });

  it("includes the full diff excerpt for a change at or under the threshold", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ markdown: "# explanation" }),
    );

    await explainCategory(
      baseInput({ production: [change({ excerpt: "+kept line" })], diffThreshold: 5 }),
      { runClaudeProcess },
    );

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).toContain("+kept line");
  });

  it("omits the diff and gives only a file/side/line-range reference over the threshold", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ markdown: "# explanation" }),
    );
    const bigExcerpt = Array.from({ length: 10 }, (_, i) => `+line${i}`).join("\n");

    await explainCategory(
      baseInput({ production: [change({ excerpt: bigExcerpt })], diffThreshold: 3 }),
      { runClaudeProcess },
    );

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).not.toContain(bigExcerpt);
    expect(prompt).toContain("src/fetch.ts");
    expect(prompt).toContain("side head");
    expect(prompt).toContain("lines 10-12");
    expect(prompt).toMatch(/omitted/);
  });

  it("returns the markdown and session id", async () => {
    const runClaudeProcess = vi.fn(async () => envelope({ markdown: "# hello" }, "abc"));

    const result = await explainCategory(baseInput(), { runClaudeProcess });

    expect(result.markdown).toBe("# hello");
    expect(result.sessionId).toBe("abc");
  });
});
