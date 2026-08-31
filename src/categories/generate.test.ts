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
  it("requests a schema shaped as { categories: [{ name, description, attention }] }, attention a hard-constrained enum", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({
        categories: [
          { name: "Retry logic", description: "Adds backoff retries.", attention: "normal" },
        ],
      }),
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
            required: ["name", "description", "attention"],
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              attention: { type: "string", enum: ["close", "normal", "skim"] },
            },
          },
        },
      },
    });
  });

  it("sends a prompt containing the title, description, files, and category guidance", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({
        categories: [
          { name: "Retry logic", description: "Adds backoff retries.", attention: "normal" },
        ],
      }),
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
      envelope({
        categories: [
          { name: "Retry logic", description: "Adds backoff retries.", attention: "normal" },
        ],
      }),
    );

    await generateCategories(INPUT, { runClaudeProcess });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    // The old "by functionality or type" wording licensed a type-based split — must be gone.
    expect(prompt).not.toMatch(/functionality or type/i);
    expect(prompt).toMatch(/never by file type/i);
  });

  it("bans a standalone tests or documentation group and requires tests/docs to ride along", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({
        categories: [
          { name: "Retry logic", description: "Adds backoff retries.", attention: "normal" },
        ],
      }),
    );

    await generateCategories(INPUT, { runClaudeProcess });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).toMatch(/don't\s+make a "tests" group or a "documentation" group/i);
    expect(prompt).toMatch(/tests and doc changes go in the same\s+group as the code they cover/i);
  });

  it("allows a coherent boilerplate group without licensing a tests/docs split", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({
        categories: [
          { name: "Retry logic", description: "Adds backoff retries.", attention: "normal" },
        ],
      }),
    );

    await generateCategories(INPUT, { runClaudeProcess });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).toMatch(/repetitive or mechanical\s+code/i);
    expect(prompt).toMatch(/this never means a tests or docs group/i);
  });

  it("asks for a per-group attention rating with the default-to-middle rubric and the anti-partition line", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({
        categories: [
          { name: "Retry logic", description: "Adds backoff retries.", attention: "normal" },
        ],
      }),
    );

    await generateCategories(INPUT, { runClaudeProcess });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).toMatch(/read closely/i);
    expect(prompt).toMatch(/read through/i);
    expect(prompt).toMatch(/skim/i);
    // Default-to-middle framing (docs/adr/0010): resists top-inflation better than a symmetric
    // anchor between the three levels.
    expect(prompt).toMatch(/start every group at\s+\*\*read through\*\*/i);
    // Anti-partition invariant (ADR 0003): attention rates an already-formed group, never a
    // second cutting axis.
    expect(prompt).toMatch(/it never changes how\s+you split/i);
    expect(prompt).toMatch(/never separate a feature's tricky core from its wiring/i);
  });

  it("no longer asks the model to order the groups — ordering is derived from attention, in code", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({
        categories: [
          { name: "Retry logic", description: "Adds backoff retries.", attention: "normal" },
        ],
      }),
    );

    await generateCategories(INPUT, { runClaudeProcess });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).not.toMatch(/order the groups by how much attention they need/i);
    expect(prompt).not.toMatch(/most important first/i);
    expect(prompt).toMatch(/you don't need to order the groups/i);
  });

  it("asks for short names, with file lists/qualifiers/parentheticals kept out of the name", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({
        categories: [
          { name: "Retry logic", description: "Adds backoff retries.", attention: "normal" },
        ],
      }),
    );

    await generateCategories(INPUT, { runClaudeProcess });

    const prompt = runClaudeProcess.mock.calls[0]?.[1];
    expect(prompt).toMatch(/keep the name to a\s+few words/i);
    expect(prompt).toMatch(/never a file list,\s+method-name qualifiers, or a parenthetical/i);
  });

  it("assigns ids 'c1', 'c2', ... in the model's own order when attention ties", async () => {
    const proposals = [
      { name: "Retry logic", description: "Adds backoff retries.", attention: "normal" },
      { name: "Backoff tests", description: "Covers the new retry behavior.", attention: "normal" },
    ];
    const runClaudeProcess = vi.fn(async () => envelope({ categories: proposals }, "abc"));

    const result = await generateCategories(INPUT, { runClaudeProcess });

    expect(result.categories).toEqual([
      { id: "c1", name: "Retry logic", description: "Adds backoff retries.", attention: "normal" },
      {
        id: "c2",
        name: "Backoff tests",
        description: "Covers the new retry behavior.",
        attention: "normal",
      },
    ]);
    expect(result.sessionId).toBe("abc");
  });

  it("stable-sorts proposals by attention rank (close, then normal, then skim) before assigning ids", async () => {
    // The model returns skim, close, normal, in that order — presentation order must derive
    // from attention rank (docs/adr/0010), not the model's emitted order, so c1 is the Read
    // closely group even though it came out of the model's reply last.
    const proposals = [
      { name: "Wiring", description: "Plumbs the new config through.", attention: "skim" },
      { name: "Retry logic", description: "Adds backoff retries.", attention: "close" },
      { name: "Docs", description: "Updates the README.", attention: "normal" },
    ];
    const runClaudeProcess = vi.fn(async () => envelope({ categories: proposals }, "abc"));

    const result = await generateCategories(INPUT, { runClaudeProcess });

    expect(result.categories.map((c) => [c.id, c.name, c.attention])).toEqual([
      ["c1", "Retry logic", "close"],
      ["c2", "Docs", "normal"],
      ["c3", "Wiring", "skim"],
    ]);
  });

  it("keeps the model's own emitted order as the tiebreak within one attention level (stable sort)", async () => {
    const proposals = [
      { name: "B", description: "Second in the model's reply.", attention: "skim" },
      { name: "A", description: "First in the model's reply.", attention: "skim" },
    ];
    const runClaudeProcess = vi.fn(async () => envelope({ categories: proposals }, "abc"));

    const result = await generateCategories(INPUT, { runClaudeProcess });

    expect(result.categories.map((c) => c.name)).toEqual(["B", "A"]);
  });

  it("keeps the code-assigned id even if a parsed proposal carries a stray 'id' field", async () => {
    // CATEGORY_SCHEMA has no additionalProperties:false, so an extra "id" key on the model's
    // reply isn't rejected — assignCategoryIds must still win, not silently adopt it.
    const proposals = [
      {
        id: "not-a-real-id",
        name: "Retry logic",
        description: "Adds retries.",
        attention: "normal",
      },
    ];
    const runClaudeProcess = vi.fn(async () => envelope({ categories: proposals }, "abc"));

    const result = await generateCategories(INPUT, { runClaudeProcess });

    expect(result.categories).toEqual([
      { id: "c1", name: "Retry logic", description: "Adds retries.", attention: "normal" },
    ]);
  });

  it("renders byte-identical prompt output (regression guard for wording changes)", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({
        categories: [
          { name: "Retry logic", description: "Adds backoff retries.", attention: "normal" },
        ],
      }),
    );

    await generateCategories(INPUT, { runClaudeProcess });

    await expect(runClaudeProcess.mock.calls[0]?.[1]).toMatchFileSnapshot(
      "__snapshots__/generate.default.txt",
    );
  });

  it("renders byte-identical prompt output for an empty/whitespace description", async () => {
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope({
        categories: [
          { name: "Retry logic", description: "Adds backoff retries.", attention: "normal" },
        ],
      }),
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
