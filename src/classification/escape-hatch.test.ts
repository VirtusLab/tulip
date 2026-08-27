import { describe, expect, it, vi } from "vitest";
import type { ClaudeProcessResult } from "../claude/exec.js";
import type { ResolvedChange } from "./classify.js";
import {
  type ClassificationState,
  MAX_ACCEPTED_NEW_CATEGORIES,
  resolveNoneClassifications,
} from "./escape-hatch.js";
import type { ClassifiableChange } from "./types.js";

function change(id: string): ClassifiableChange {
  return {
    id,
    path: "src/fetch.ts",
    status: "modified",
    side: "head",
    range: { start: 1, end: 1 },
    excerpt: "+line",
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

function baseState(overrides: Partial<ClassificationState> = {}): ClassificationState {
  return {
    categories: [{ name: "Retry logic", description: "Adds backoff retries." }],
    phase1SessionId: "phase1-session",
    classifierSessionId: "classifier-session",
    acceptedNewCategories: 0,
    ...overrides,
  };
}

describe("resolveNoneClassifications", () => {
  it("returns unchanged when there are no 'none' entries", async () => {
    const resolved = new Map<string, ResolvedChange>([
      [
        "c1",
        { kind: "categorized", assignments: [{ category: "Retry logic", codeType: "production" }] },
      ],
    ]);
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) => envelope({}, "x"));

    const result = await resolveNoneClassifications(
      resolved,
      new Map([["c1", change("c1")]]),
      baseState(),
      { runClaudeProcess },
    );

    expect(result).toBe(resolved);
    expect(runClaudeProcess).not.toHaveBeenCalled();
  });

  it("accepts a new category, extends the list, and asks the classifier to redo just that change", async () => {
    const resolved = new Map<string, ResolvedChange>([
      [
        "c1",
        {
          kind: "none",
          suggestedCategory: { name: "Metrics", description: "Adds counters." },
          existingAssignments: [],
        },
      ],
    ]);
    let call = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], input: string) => {
      call++;
      if (call === 1) {
        // consultOnCategory (resumes the phase-1 session)
        expect(input).toContain("Metrics");
        return envelope(
          { accept: true, category: { name: "Metrics", description: "Adds counters (refined)." } },
          "phase1-session-2",
        );
      }
      // classifier resume
      expect(input).toContain("accepted");
      expect(input).toContain("Metrics");
      return envelope(
        {
          classifications: [
            { changeId: "c1", assignments: [{ category: "Metrics", codeType: "production" }] },
          ],
        },
        "classifier-session-2",
      );
    });

    const state = baseState();
    const result = await resolveNoneClassifications(
      resolved,
      new Map([["c1", change("c1")]]),
      state,
      { runClaudeProcess },
    );

    expect(result.get("c1")).toEqual({
      kind: "categorized",
      assignments: [{ category: "Metrics", codeType: "production" }],
    });
    expect(state.categories).toContainEqual({
      name: "Metrics",
      description: "Adds counters (refined).",
    });
    expect(state.acceptedNewCategories).toBe(1);
    expect(state.phase1SessionId).toBe("phase1-session-2");
    expect(state.classifierSessionId).toBe("classifier-session-2");
  });

  it("rejects a new category and asks the classifier to pick from the existing list, no 'none' allowed", async () => {
    const resolved = new Map<string, ResolvedChange>([
      [
        "c1",
        {
          kind: "none",
          suggestedCategory: { name: "Misc", description: "Doesn't fit." },
          existingAssignments: [],
        },
      ],
    ]);
    let call = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], input: string) => {
      call++;
      if (call === 1) {
        return envelope({ accept: false }, "phase1-session-2");
      }
      expect(input).toMatch(/not accepted/i);
      expect(input).toMatch(/do not reply "none"/i);
      return envelope(
        {
          classifications: [
            { changeId: "c1", assignments: [{ category: "Retry logic", codeType: "test" }] },
          ],
        },
        "classifier-session-2",
      );
    });

    const state = baseState();
    const result = await resolveNoneClassifications(
      resolved,
      new Map([["c1", change("c1")]]),
      state,
      { runClaudeProcess },
    );

    expect(result.get("c1")).toEqual({
      kind: "categorized",
      assignments: [{ category: "Retry logic", codeType: "test" }],
    });
    expect(state.acceptedNewCategories).toBe(0);
    expect(state.categories).toEqual([
      { name: "Retry logic", description: "Adds backoff retries." },
    ]);
  });

  it("rejects further 'none' proposals without consulting once the new-category cap is hit", async () => {
    const resolved = new Map<string, ResolvedChange>([
      [
        "c1",
        {
          kind: "none",
          suggestedCategory: { name: "Extra", description: "One more." },
          existingAssignments: [],
        },
      ],
    ]);
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope(
        {
          classifications: [
            { changeId: "c1", assignments: [{ category: "Retry logic", codeType: "production" }] },
          ],
        },
        "classifier-session-2",
      ),
    );

    const state = baseState({ acceptedNewCategories: MAX_ACCEPTED_NEW_CATEGORIES });
    await resolveNoneClassifications(resolved, new Map([["c1", change("c1")]]), state, {
      runClaudeProcess,
    });

    // Only the classifier resume happened — no consultOnCategory call (that would be call 1 too, but
    // since it's capped, the only call is the classifier resume).
    expect(runClaudeProcess).toHaveBeenCalledTimes(1);
    expect(state.acceptedNewCategories).toBe(MAX_ACCEPTED_NEW_CATEGORIES);
  });

  it("stops consulting mid-pass once the cap is reached, even with more 'none' changes pending", async () => {
    const resolved = new Map<string, ResolvedChange>([
      [
        "c1",
        {
          kind: "none",
          suggestedCategory: { name: "One", description: "First extra." },
          existingAssignments: [],
        },
      ],
      [
        "c2",
        {
          kind: "none",
          suggestedCategory: { name: "Two", description: "Second extra." },
          existingAssignments: [],
        },
      ],
    ]);
    let consultCalls = 0;
    const runClaudeProcess = vi.fn(async (args: string[], _input: string) => {
      if (!args.includes("--resume") || args[args.indexOf("--resume") + 1] === "phase1-session") {
        consultCalls++;
        return envelope(
          { accept: true, category: { name: "One", description: "First extra." } },
          "phase1-session",
        );
      }
      return envelope(
        {
          classifications: [
            { changeId: "c1", assignments: [{ category: "One", codeType: "production" }] },
            { changeId: "c2", assignments: [{ category: "Retry logic", codeType: "production" }] },
          ],
        },
        "classifier-session-2",
      );
    });

    const state = baseState({ acceptedNewCategories: MAX_ACCEPTED_NEW_CATEGORIES - 1 });
    await resolveNoneClassifications(
      resolved,
      new Map([
        ["c1", change("c1")],
        ["c2", change("c2")],
      ]),
      state,
      { runClaudeProcess },
    );

    // Only c1 gets consulted (bringing acceptedNewCategories to the cap); c2 is auto-rejected.
    expect(consultCalls).toBe(1);
    expect(state.acceptedNewCategories).toBe(MAX_ACCEPTED_NEW_CATEGORIES);
  });

  it("does not retry when the classifier still replies 'none' — leaves it for coverage repair", async () => {
    const resolved = new Map<string, ResolvedChange>([
      [
        "c1",
        {
          kind: "none",
          suggestedCategory: { name: "Extra", description: "One more." },
          existingAssignments: [],
        },
      ],
    ]);
    const runClaudeProcess = vi.fn(async (_args: string[], _input: string) =>
      envelope(
        {
          classifications: [
            {
              changeId: "c1",
              assignments: [
                {
                  category: "none",
                  codeType: "production",
                  suggestedCategory: { name: "Extra", description: "One more." },
                },
              ],
            },
          ],
        },
        "classifier-session-2",
      ),
    );

    const result = await resolveNoneClassifications(
      resolved,
      new Map([["c1", change("c1")]]),
      baseState({ acceptedNewCategories: MAX_ACCEPTED_NEW_CATEGORIES }),
      { runClaudeProcess },
    );

    // Single pass: one classifier resume, no internal retry loop.
    expect(runClaudeProcess).toHaveBeenCalledTimes(1);
    expect(result.get("c1")).toMatchObject({ kind: "none" });
  });
});
