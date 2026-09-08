import { describe, expect, it, vi } from "vitest";
import type { Category } from "../categories/types.js";
import type { ClaudeProcessResult } from "../claude/exec.js";
import { createUsageLedger } from "../claude/usage.js";
import type { Change, DiffSide, FileDiff, ParsedDiff } from "../diff/change.js";
import type { Logger } from "../logging/logger.js";
import { splitLargeChanges } from "./orchestrate.js";
import type { SplitResponse } from "./wire.js";

const CATEGORIES: Category[] = [{ id: "c1", name: "A", description: "first", attention: "normal" }];

/** A change of exactly `count` lines starting at `start` — over the 120-line split threshold when
 * count > 120. */
function change(path: string, side: DiffSide, start: number, count: number): Change {
  const marker = side === "head" ? "+" : "-";
  const end = start + count - 1;
  return {
    id: `${path}:${side}:${start}-${end}`,
    path,
    side,
    range: { start, end },
    lines: Array.from({ length: count }, (_, i) => `${marker}line ${start + i}`),
  };
}

function file(changes: Change[], overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    path: changes[0]?.path ?? "src/x.ts",
    status: "modified",
    binary: false,
    changes,
    ...overrides,
  };
}

function envelope(output: SplitResponse): ClaudeProcessResult {
  return {
    stdout: JSON.stringify({
      result: "done",
      session_id: "split-1",
      structured_output: output,
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    stderr: "",
  };
}

function mockProcess(output: SplitResponse) {
  return vi.fn(async () => envelope(output));
}

describe("splitLargeChanges", () => {
  it("returns the diff untouched when there are no candidates", async () => {
    const runClaudeProcess = vi.fn();
    const diff: ParsedDiff = { files: [file([change("src/a.ts", "head", 1, 3)])] };
    const result = await splitLargeChanges({ diff, categories: CATEGORIES }, { runClaudeProcess });
    expect(result).toBe(diff);
    expect(runClaudeProcess).not.toHaveBeenCalled();
  });

  it("splits a candidate into segments and leaves non-candidates and order intact", async () => {
    const big = change("src/a.ts", "head", 1, 130);
    const small = change("src/a.ts", "head", 200, 2);
    const diff: ParsedDiff = { files: [file([big, small])] };
    const runClaudeProcess = mockProcess({ splits: [{ changeId: big.id, splitBefore: [50] }] });

    const result = await splitLargeChanges({ diff, categories: CATEGORIES }, { runClaudeProcess });

    expect(result.files[0]?.changes.map((c) => c.id)).toEqual([
      "src/a.ts:head:1-49",
      "src/a.ts:head:50-130",
      small.id,
    ]);
  });

  it("passes a candidate through whole for an empty split list", async () => {
    const big = change("src/a.ts", "head", 1, 130);
    const diff: ParsedDiff = { files: [file([big])] };
    const runClaudeProcess = mockProcess({ splits: [{ changeId: big.id, splitBefore: [] }] });

    const result = await splitLargeChanges({ diff, categories: CATEGORIES }, { runClaudeProcess });

    expect(result.files[0]?.changes.map((c) => c.id)).toEqual([big.id]);
  });

  it("ignores an unknown changeId in the response", async () => {
    const big = change("src/a.ts", "head", 1, 130);
    const diff: ParsedDiff = { files: [file([big])] };
    const runClaudeProcess = mockProcess({
      splits: [
        { changeId: "src/nope.ts:head:1-2", splitBefore: [99] },
        { changeId: big.id, splitBefore: [70] },
      ],
    });

    const result = await splitLargeChanges({ diff, categories: CATEGORIES }, { runClaudeProcess });

    expect(result.files[0]?.changes.map((c) => c.id)).toEqual([
      "src/a.ts:head:1-69",
      "src/a.ts:head:70-130",
    ]);
  });

  it("leaves a batch's changes whole and logs when its session fails (fail-soft)", async () => {
    const big = change("src/a.ts", "head", 1, 130);
    const diff: ParsedDiff = { files: [file([big])] };
    const runClaudeProcess = vi.fn(async () => {
      throw new Error("boom");
    });
    const messages: string[] = [];
    const logger: Logger = { info: (m) => messages.push(m), debug: () => {} };

    const result = await splitLargeChanges(
      { diff, categories: CATEGORIES },
      { runClaudeProcess, logger },
    );

    expect(result.files[0]?.changes.map((c) => c.id)).toEqual([big.id]);
    expect(messages.some((m) => m.includes("failed") && m.includes("boom"))).toBe(true);
  });

  it("splits both sides of a renamed file, keeping previousPath and status", async () => {
    const baseSide = change("src/new.ts", "base", 1, 130);
    const headSide = change("src/new.ts", "head", 1, 130);
    const diff: ParsedDiff = {
      files: [
        file([baseSide, headSide], {
          path: "src/new.ts",
          previousPath: "src/old.ts",
          status: "renamed",
        }),
      ],
    };
    const runClaudeProcess = mockProcess({
      splits: [
        { changeId: baseSide.id, splitBefore: [40] },
        { changeId: headSide.id, splitBefore: [60] },
      ],
    });

    const result = await splitLargeChanges({ diff, categories: CATEGORIES }, { runClaudeProcess });
    const rebuilt = result.files[0];

    expect(rebuilt?.previousPath).toBe("src/old.ts");
    expect(rebuilt?.status).toBe("renamed");
    expect(rebuilt?.changes.map((c) => c.id)).toEqual([
      "src/new.ts:base:1-39",
      "src/new.ts:base:40-130",
      "src/new.ts:head:1-59",
      "src/new.ts:head:60-130",
    ]);
  });

  it("records the split session's usage under the threaded ledger", async () => {
    const big = change("src/a.ts", "head", 1, 130);
    const diff: ParsedDiff = { files: [file([big])] };
    const runClaudeProcess = mockProcess({ splits: [{ changeId: big.id, splitBefore: [50] }] });
    const usage = createUsageLedger();

    await splitLargeChanges({ diff, categories: CATEGORIES }, { runClaudeProcess, usage });

    expect(usage.rows()).toEqual([
      { model: "sonnet", tokens: { input: 10, output: 5, cacheWrite: 0, cacheRead: 0 } },
    ]);
  });

  it("runs one session per batch when candidates exceed the count cap", async () => {
    // 25 candidates > maxBatchSize (20) -> two batches -> two fresh sessions.
    const changes = Array.from({ length: 25 }, (_, i) => change(`src/f${i}.ts`, "head", 1, 130));
    const diff: ParsedDiff = { files: changes.map((c) => file([c])) };
    const runClaudeProcess = mockProcess({ splits: [] });

    await splitLargeChanges({ diff, categories: CATEGORIES }, { runClaudeProcess });

    expect(runClaudeProcess).toHaveBeenCalledTimes(2);
  });
});
