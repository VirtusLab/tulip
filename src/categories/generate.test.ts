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
  it("requests a schema shaped as { categories: [{ name, description }] }", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ categories: [{ name: "Retry logic", description: "Adds backoff retries." }] }),
    );

    await generateCategories(INPUT, { runClaudeProcess });

    const args = runClaudeProcess.mock.calls[0]?.[0] as string[];
    const schema = JSON.parse(args[args.indexOf("--json-schema") + 1] ?? "{}");
    expect(schema).toEqual({
      type: "object",
      required: ["categories"],
      properties: {
        categories: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "description"],
            properties: { name: { type: "string" }, description: { type: "string" } },
          },
        },
      },
    });
  });

  it("sends a prompt containing the title, description, files, and category guidance", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ categories: [{ name: "Retry logic", description: "Adds backoff retries." }] }),
    );

    await generateCategories(INPUT, { runClaudeProcess });

    const [args, prompt] = runClaudeProcess.mock.calls[0] ?? [];
    expect(prompt).toContain(INPUT.title);
    expect(prompt).toContain(INPUT.description);
    expect(prompt).toContain("src/fetch.ts (modified)");
    expect(prompt).toContain("src/fetch.test.ts (modified)");
    expect(prompt).toMatch(/self-contained/i);
    expect(prompt).toMatch(/most important|attention/i);
    expect((args as string[])[(args as string[]).indexOf("--model") + 1]).toBe("sonnet");
  });

  it("groups by functionality/concern, never by file type", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ categories: [{ name: "Retry logic", description: "Adds backoff retries." }] }),
    );

    await generateCategories(INPUT, { runClaudeProcess });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    // The old "by functionality or type" wording licensed a type-based split — must be gone.
    expect(prompt).not.toMatch(/functionality or type/i);
    expect(prompt).toMatch(/never by file type/i);
  });

  it("bans a standalone tests or documentation group and requires tests/docs to ride along", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ categories: [{ name: "Retry logic", description: "Adds backoff retries." }] }),
    );

    await generateCategories(INPUT, { runClaudeProcess });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).toMatch(/don't\s+make a "tests" group or a "documentation" group/i);
    expect(prompt).toMatch(/tests and doc changes go in the same\s+group as the code they cover/i);
  });

  it("allows a coherent boilerplate group without licensing a tests/docs split", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ categories: [{ name: "Retry logic", description: "Adds backoff retries." }] }),
    );

    await generateCategories(INPUT, { runClaudeProcess });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).toMatch(/repetitive or mechanical\s+code/i);
    expect(prompt).toMatch(/this never means a tests or docs group/i);
  });

  it("orders groups by attention and asks for a read-carefully/skim label per group", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ categories: [{ name: "Retry logic", description: "Adds backoff retries." }] }),
    );

    await generateCategories(INPUT, { runClaudeProcess });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).toMatch(/order the groups by how much attention they need/i);
    expect(prompt).toMatch(/read carefully/i);
    expect(prompt).toMatch(/skim/i);
  });

  it("asks for short names, with file lists/qualifiers/parentheticals kept out of the name", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ categories: [{ name: "Retry logic", description: "Adds backoff retries." }] }),
    );

    await generateCategories(INPUT, { runClaudeProcess });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).toMatch(/keep the name to a\s+few words/i);
    expect(prompt).toMatch(/never a file list,\s+method-name qualifiers, or a parenthetical/i);
  });

  it("assigns ids 'c1', 'c2', ... in presentation order, on top of the model's name+description", async () => {
    const proposals = [
      { name: "Retry logic", description: "Adds backoff retries." },
      { name: "Backoff tests", description: "Covers the new retry behavior." },
    ];
    const runClaudeProcess = vi.fn(async () => envelope({ categories: proposals }, "abc"));

    const result = await generateCategories(INPUT, { runClaudeProcess });

    expect(result.categories).toEqual([
      { id: "c1", name: "Retry logic", description: "Adds backoff retries." },
      { id: "c2", name: "Backoff tests", description: "Covers the new retry behavior." },
    ]);
    expect(result.sessionId).toBe("abc");
  });

  it("keeps the code-assigned id even if a parsed proposal carries a stray 'id' field", async () => {
    // CATEGORY_SCHEMA has no additionalProperties:false, so an extra "id" key on the model's
    // reply isn't rejected — assignCategoryIds must still win, not silently adopt it.
    const proposals = [{ id: "not-a-real-id", name: "Retry logic", description: "Adds retries." }];
    const runClaudeProcess = vi.fn(async () => envelope({ categories: proposals }, "abc"));

    const result = await generateCategories(INPUT, { runClaudeProcess });

    expect(result.categories).toEqual([
      { id: "c1", name: "Retry logic", description: "Adds retries." },
    ]);
  });

  it("renders byte-identical prompt output (regression guard for wording changes)", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ categories: [{ name: "Retry logic", description: "Adds backoff retries." }] }),
    );

    await generateCategories(INPUT, { runClaudeProcess });

    await expect(runClaudeProcess.mock.calls[0]?.[1]).toMatchFileSnapshot(
      "__snapshots__/generate.default.txt",
    );
  });

  it("renders byte-identical prompt output for an empty/whitespace description", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({ categories: [{ name: "Retry logic", description: "Adds backoff retries." }] }),
    );

    await generateCategories(
      { title: "Trivial fix", description: "   ", files: [{ path: "src/a.ts", status: "added" }] },
      { runClaudeProcess },
    );

    await expect(runClaudeProcess.mock.calls[0]?.[1]).toMatchFileSnapshot(
      "__snapshots__/generate.empty-description.txt",
    );
  });

  it("rejects an empty category list", async () => {
    const runClaudeProcess = vi.fn(async () => envelope({ categories: [] }));

    await expect(generateCategories(INPUT, { runClaudeProcess })).rejects.toThrow(
      ClaudeOutputError,
    );
  });
});
