import { describe, expect, it, vi } from "vitest";
import type { Category } from "../categories/types.js";
import { ClaudeOutputError } from "../claude/errors.js";
import type { ClaudeProcessResult } from "../claude/exec.js";
import { type AfterBatchHook, classifyInBatches, resolveRawClassification } from "./classify.js";
import type { ClassifiableChange } from "./types.js";
import type { RawChangeClassification } from "./wire.js";

const CATEGORIES: Category[] = [{ name: "Retry logic", description: "Adds backoff retries." }];

/** A no-op afterBatch hook, for tests that don't exercise the escape hatch. */
const passThrough: AfterBatchHook = async (resolved, classifierSessionId, categories) => ({
  resolved,
  classifierSessionId,
  categories,
});

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
  it("sends the category list and special-category explanation in the first batch", async () => {
    const changes = [change("c1")];
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope([
        { changeId: "c1", assignments: [{ category: "Retry logic", codeType: "production" }] },
      ]),
    );

    await classifyInBatches(CATEGORIES, changes, passThrough, { runClaudeProcess });

    const [args, prompt] = runClaudeProcess.mock.calls[0] ?? [];
    expect(prompt).toContain("Retry logic");
    expect(prompt).toContain("Adds backoff retries.");
    expect(prompt).toMatch(/"ignore"/);
    expect(prompt).toMatch(/"none"/);
    expect((args as string[])[(args as string[]).indexOf("--model") + 1]).toBe("haiku");
  });

  it("resumes the same session for later batches, restating the current category list", async () => {
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

    await classifyInBatches(CATEGORIES, changes, passThrough, { runClaudeProcess });

    expect(runClaudeProcess).toHaveBeenCalledTimes(2);
    const [firstArgs] = runClaudeProcess.mock.calls[0] ?? [];
    const [secondArgs, secondPrompt] = runClaudeProcess.mock.calls[1] ?? [];
    expect(firstArgs as string[]).toContain("--model");
    expect(secondArgs as string[]).not.toContain("--model");
    expect(secondArgs).toContain("--resume");
    expect(secondPrompt).toContain("Retry logic");
  });

  it("threads the afterBatch hook's updated categories/session into the next batch's prompt", async () => {
    const changes = Array.from({ length: 21 }, (_, i) => change(`c${i}`));
    const extraCategory: Category = { name: "New area", description: "Escape-hatch addition." };
    let call = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) => {
      call++;
      const batch = call === 1 ? changes.slice(0, 20) : changes.slice(20);
      return envelope(
        batch.map((c) => ({
          changeId: c.id,
          assignments: [{ category: "Retry logic", codeType: "production" }],
        })),
        `raw-session-${call}`,
      );
    });

    const afterBatch: AfterBatchHook = async (resolved) => ({
      resolved,
      classifierSessionId: "hook-session",
      categories: [...CATEGORIES, extraCategory],
    });

    await classifyInBatches(CATEGORIES, changes, afterBatch, { runClaudeProcess });

    const [secondArgs, secondPrompt] = runClaudeProcess.mock.calls[1] ?? [];
    expect((secondArgs as string[])[(secondArgs as string[]).indexOf("--resume") + 1]).toBe(
      "hook-session",
    );
    expect(secondPrompt).toContain("New area");
    expect(secondPrompt).toContain("Escape-hatch addition.");
  });

  it("parses assignments, keyed by changeId", async () => {
    const changes = [change("c1")];
    const runClaudeProcess = vi.fn(async () =>
      envelope([
        { changeId: "c1", assignments: [{ category: "Retry logic", codeType: "production" }] },
      ]),
    );

    const { resolved } = await classifyInBatches(CATEGORIES, changes, passThrough, {
      runClaudeProcess,
    });

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

    const { resolved } = await classifyInBatches(CATEGORIES, changes, passThrough, {
      runClaudeProcess,
    });

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

    const { resolved } = await classifyInBatches(CATEGORIES, changes, passThrough, {
      runClaudeProcess,
    });

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

    const { resolved } = await classifyInBatches(CATEGORIES, changes, passThrough, {
      runClaudeProcess,
    });

    expect(resolved.get("c1")).toEqual({ kind: "ignored" });
  });
});

describe("resolveRawClassification", () => {
  it("resolves 'none' with a suggestedCategory to kind: none, with no existing assignments", () => {
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
      existingAssignments: [],
    });
  });

  it("keeps real assignments alongside a 'none' entry instead of discarding them", () => {
    const entry: RawChangeClassification = {
      changeId: "c1",
      assignments: [
        { category: "Retry logic", codeType: "production" },
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
      existingAssignments: [{ category: "Retry logic", codeType: "production" }],
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
