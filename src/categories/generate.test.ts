import { describe, expect, it, vi } from "vitest";
import { ClaudeOutputError } from "../claude/errors.js";
import type { ClaudeProcessResult } from "../claude/exec.js";
import { type GenerateCategoriesInput, generateCategories } from "./generate.js";

const INPUT: GenerateCategoriesInput = {
  title: "Add retry logic to the fetcher",
  description: "Retries transient network failures with backoff.",
  files: [
    { path: "src/fetch.ts", status: "modified" },
    { path: "src/fetch.test.ts", status: "modified" },
  ],
};

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

describe("generateCategories", () => {
  it("sends a prompt containing the title, description, files, and category guidance", async () => {
    const runClaudeProcess = vi.fn(async () =>
      envelope({ categories: [{ name: "Retry logic", description: "Adds backoff retries." }] }),
    );

    await generateCategories(INPUT, { runClaudeProcess });

    const [args, prompt] = runClaudeProcess.mock.calls[0] ?? [];
    expect(prompt).toContain(INPUT.title);
    expect(prompt).toContain(INPUT.description);
    expect(prompt).toContain("src/fetch.ts (modified)");
    expect(prompt).toContain("src/fetch.test.ts (modified)");
    expect(prompt).toMatch(/self-contained/i);
    expect(prompt).toMatch(/most important|highest-impact/i);
    expect((args as string[])[(args as string[]).indexOf("--model") + 1]).toBe("sonnet");
  });

  it("returns the ordered categories and session id on a valid response", async () => {
    const categories = [
      { name: "Retry logic", description: "Adds backoff retries." },
      { name: "Tests", description: "Covers the new retry behavior." },
    ];
    const runClaudeProcess = vi.fn(async () => envelope({ categories }, "abc"));

    const result = await generateCategories(INPUT, { runClaudeProcess });

    expect(result.categories).toEqual(categories);
    expect(result.sessionId).toBe("abc");
  });

  it("rejects an empty category list", async () => {
    const runClaudeProcess = vi.fn(async () => envelope({ categories: [] }));

    await expect(generateCategories(INPUT, { runClaudeProcess })).rejects.toThrow(
      ClaudeOutputError,
    );
  });
});
