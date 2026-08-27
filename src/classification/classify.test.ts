import { describe, expect, it, vi } from "vitest";
import type { Category } from "../categories/types.js";
import { ClaudeOutputError } from "../claude/errors.js";
import type { ClaudeProcessResult } from "../claude/exec.js";
import { classifyInBatches, resolveRawClassification } from "./classify.js";
import type { ClassifiableChange, RawChangeClassification } from "./types.js";

const CATEGORIES: Category[] = [{ name: "Retry logic", description: "Adds backoff retries." }];

function change(id: string, excerpt = "+line"): ClassifiableChange {
  return {
    id,
    path: "src/fetch.ts",
    status: "modified",
    side: "head",
    range: { start: 1, end: 1 },
    excerpt,
  };
}

function envelope(classifications: unknown, sessionId = "session-1"): ClaudeProcessResult {
  return {
    stdout: JSON.stringify({
      result: "done",
      session_id: sessionId,
      structured_output: { classifications },
    }),
    stderr: "",
  };
}

describe("classifyInBatches", () => {
  it("sends the category list and special-category explanation only in the first batch", async () => {
    const changes = [change("c1")];
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope([
        { changeId: "c1", assignments: [{ category: "Retry logic", codeType: "production" }] },
      ]),
    );

    await classifyInBatches(CATEGORIES, changes, { runClaudeProcess });

    const [args, prompt] = runClaudeProcess.mock.calls[0] ?? [];
    expect(prompt).toContain("Retry logic");
    expect(prompt).toContain("Adds backoff retries.");
    expect(prompt).toMatch(/"ignore"/);
    expect(prompt).toMatch(/"none"/);
    expect((args as string[])[(args as string[]).indexOf("--model") + 1]).toBe("haiku");
  });

  it("resumes the same session for later batches instead of re-sending the category list", async () => {
    // Force two batches by exceeding MAX_BATCH_SIZE (20).
    const changes = Array.from({ length: 25 }, (_, i) => change(`c${i}`));
    let call = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) => {
      call++;
      const batch = call === 1 ? changes.slice(0, 20) : changes.slice(20);
      return envelope(
        batch.map((c) => ({
          changeId: c.id,
          assignments: [{ category: "Retry logic", codeType: "production" }],
        })),
        `session-${call}`,
      );
    });

    await classifyInBatches(CATEGORIES, changes, { runClaudeProcess });

    expect(runClaudeProcess).toHaveBeenCalledTimes(2);
    const [firstArgs] = runClaudeProcess.mock.calls[0] ?? [];
    const [secondArgs, secondPrompt] = runClaudeProcess.mock.calls[1] ?? [];
    expect(firstArgs as string[]).toContain("--model");
    expect(secondArgs as string[]).not.toContain("--model");
    expect(secondArgs).toContain("--resume");
    expect(secondPrompt).not.toContain("Retry logic:");
  });

  it("parses assignments, keyed by changeId", async () => {
    const changes = [change("c1")];
    const runClaudeProcess = vi.fn(async () =>
      envelope([
        { changeId: "c1", assignments: [{ category: "Retry logic", codeType: "production" }] },
      ]),
    );

    const { resolved } = await classifyInBatches(CATEGORIES, changes, { runClaudeProcess });

    expect(resolved.get("c1")).toEqual({
      kind: "categorized",
      assignments: [{ category: "Retry logic", codeType: "production" }],
    });
  });

  it("keeps multiple assignments for a change that belongs to more than one category", async () => {
    const changes = [change("c1")];
    const runClaudeProcess = vi.fn(async () =>
      envelope([
        {
          changeId: "c1",
          assignments: [
            { category: "Retry logic", codeType: "production" },
            { category: "Logging", codeType: "production" },
          ],
        },
      ]),
    );

    const { resolved } = await classifyInBatches(CATEGORIES, changes, { runClaudeProcess });

    expect(resolved.get("c1")).toEqual({
      kind: "categorized",
      assignments: [
        { category: "Retry logic", codeType: "production" },
        { category: "Logging", codeType: "production" },
      ],
    });
  });

  it("splits production vs test code type per assignment", async () => {
    const changes = [change("c1"), change("c2")];
    const runClaudeProcess = vi.fn(async () =>
      envelope([
        { changeId: "c1", assignments: [{ category: "Retry logic", codeType: "production" }] },
        { changeId: "c2", assignments: [{ category: "Retry logic", codeType: "test" }] },
      ]),
    );

    const { resolved } = await classifyInBatches(CATEGORIES, changes, { runClaudeProcess });

    expect(resolved.get("c1")).toMatchObject({ assignments: [{ codeType: "production" }] });
    expect(resolved.get("c2")).toMatchObject({ assignments: [{ codeType: "test" }] });
  });

  it("resolves an 'ignore' assignment to kind: ignored, regardless of other assignments", async () => {
    const changes = [change("c1")];
    const runClaudeProcess = vi.fn(async () =>
      envelope([
        {
          changeId: "c1",
          assignments: [{ category: "ignore", codeType: "production" }],
        },
      ]),
    );

    const { resolved } = await classifyInBatches(CATEGORIES, changes, { runClaudeProcess });

    expect(resolved.get("c1")).toEqual({ kind: "ignored" });
  });
});

describe("resolveRawClassification", () => {
  it("resolves 'none' with a suggestedCategory to kind: none", () => {
    const entry: RawChangeClassification = {
      changeId: "c1",
      assignments: [
        {
          category: "none",
          codeType: "production",
          suggestedCategory: { name: "New area", description: "Doesn't fit elsewhere." },
        },
      ],
    };

    expect(resolveRawClassification(entry)).toEqual({
      kind: "none",
      suggestedCategory: { name: "New area", description: "Doesn't fit elsewhere." },
    });
  });

  it("throws ClaudeOutputError for 'none' without a suggestedCategory", () => {
    const entry: RawChangeClassification = {
      changeId: "c1",
      assignments: [{ category: "none", codeType: "production" }],
    };

    expect(() => resolveRawClassification(entry)).toThrow(ClaudeOutputError);
  });
});
