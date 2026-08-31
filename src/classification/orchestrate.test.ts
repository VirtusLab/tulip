import { describe, expect, it, vi } from "vitest";
import type { Category } from "../categories/types.js";
import type { ClaudeProcessResult } from "../claude/exec.js";
import type { Change, ParsedDiff } from "../diff/change.js";
import { classifyChanges } from "./orchestrate.js";

function fileWithChange(id: string): ParsedDiff["files"][number] {
  const change: Change = {
    id,
    path: `src/${id}.ts`,
    side: "head",
    range: { start: 1, end: 1 },
    lines: ["+line"],
  };
  return { path: change.path, status: "modified", binary: false, changes: [change] };
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

const CATEGORIES: Category[] = [{ id: "c1", name: "A", description: "first", attention: "normal" }];

describe("classifyChanges", () => {
  it("runs classification, escape hatch and coverage repair end to end", async () => {
    // change "c1": classified directly under category id c1. change "c2": "none" -> accepted as
    // new category "B" (assigned id c2), re-classified under it. change "c3": "ignore". change
    // "c4": missing from every reply until the coverage-repair round.
    const diff: ParsedDiff = {
      files: [
        fileWithChange("c1"),
        fileWithChange("c2"),
        fileWithChange("c3"),
        fileWithChange("c4"),
      ],
    };

    let classifierResumeCount = 0;
    const runClaudeProcess = vi.fn(async (args: string[], input: string) => {
      if (args.includes("--model")) {
        // Classifier replies with the category id ("c1"), not the name ("A") — see
        // docs/adr/0005.
        return envelope(
          {
            classifications: [
              { changeId: "c1", assignments: [{ category: "c1", codeType: "production" }] },
              {
                changeId: "c2",
                assignments: [
                  {
                    category: "none",
                    codeType: "production",
                    suggestedCategory: { name: "B", description: "proposed", attention: "normal" },
                  },
                ],
              },
              { changeId: "c3", assignments: [{ category: "ignore", codeType: "production" }] },
              // c4 intentionally omitted, to trigger coverage repair.
            ],
          },
          "classifier-1",
        );
      }

      const resumeId = args[args.indexOf("--resume") + 1];
      if (resumeId === "phase1-0") {
        // consultOnCategory, resuming the phase-1 session. The model proposes/refines by name
        // only — it never assigns an id (see docs/adr/0005); escape-hatch.ts assigns "c2" itself.
        expect(input).toContain("B");
        return envelope(
          { accept: true, category: { name: "B", description: "refined", attention: "normal" } },
          "phase1-1",
        );
      }

      classifierResumeCount++;
      if (classifierResumeCount === 1) {
        // Escape-hatch retry, for c2 only. The resume prompt must tell the classifier the new
        // category's id ("c2"), and the reply uses that id.
        expect(input).toContain("c2");
        return envelope(
          {
            classifications: [
              { changeId: "c2", assignments: [{ category: "c2", codeType: "test" }] },
            ],
          },
          "classifier-2",
        );
      }
      // Coverage repair, for c4 only.
      expect(input).toContain("c4");
      return envelope(
        {
          classifications: [
            { changeId: "c4", assignments: [{ category: "c1", codeType: "production" }] },
          ],
        },
        "classifier-3",
      );
    });

    const result = await classifyChanges(
      { diff, categories: CATEGORIES, phase1SessionId: "phase1-0" },
      { runClaudeProcess },
    );

    expect(result.categories).toEqual([
      { id: "c1", name: "A", description: "first", attention: "normal" },
      { id: "c2", name: "B", description: "refined", attention: "normal" },
    ]);
    expect(result.assignments.get("c1")).toEqual([{ category: "c1", codeType: "production" }]);
    expect(result.assignments.get("c2")).toEqual([{ category: "c2", codeType: "test" }]);
    expect(result.assignments.get("c4")).toEqual([{ category: "c1", codeType: "production" }]);
    expect(result.assignments.has("c3")).toBe(false);
    expect(result.ignoredChangeIds).toEqual(new Set(["c3"]));
    expect([...result.changesById.keys()].sort()).toEqual(["c1", "c2", "c3", "c4"]);
    expect(runClaudeProcess).toHaveBeenCalledTimes(4);
  });

  it("threads a category accepted while resolving batch 1 into batch 2's prompt", async () => {
    // 20 changes in batch 1 (one proposes "none" -> accepted as "B", assigned id c2), 5 more in
    // batch 2.
    const batch1Ids = Array.from({ length: 20 }, (_, i) => `b1-${i}`);
    const batch2Ids = Array.from({ length: 5 }, (_, i) => `b2-${i}`);
    const diff: ParsedDiff = {
      files: [...batch1Ids, ...batch2Ids].map((id) => fileWithChange(id)),
    };

    let call = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], input: string) => {
      call++;
      if (call === 1) {
        // Batch 1 (fresh session): b1-0 comes back "none", suggesting category "B".
        const classifications = batch1Ids.map((id) =>
          id === "b1-0"
            ? {
                changeId: id,
                assignments: [
                  {
                    category: "none",
                    codeType: "production",
                    suggestedCategory: { name: "B", description: "proposed", attention: "normal" },
                  },
                ],
              }
            : { changeId: id, assignments: [{ category: "c1", codeType: "production" }] },
        );
        return envelope({ classifications }, "classifier-1");
      }
      if (call === 2) {
        // consultOnCategory, resuming the phase-1 session — accept, refining the description.
        return envelope(
          { accept: true, category: { name: "B", description: "refined", attention: "normal" } },
          "phase1-1",
        );
      }
      if (call === 3) {
        // Escape-hatch reclassify, for b1-0 only, before batch 2 is ever asked. Replies with the
        // newly assigned id "c2".
        return envelope(
          {
            classifications: [
              { changeId: "b1-0", assignments: [{ category: "c2", codeType: "production" }] },
            ],
          },
          "classifier-2",
        );
      }
      // Batch 2's prompt: must already list "B" (id c2), accepted while resolving batch 1.
      expect(input).toContain("B");
      expect(input).toContain("refined");
      expect(input).toContain("c2");
      const classifications = batch2Ids.map((id) => ({
        changeId: id,
        assignments: [{ category: "c1", codeType: "production" }],
      }));
      return envelope({ classifications }, "classifier-3");
    });

    const result = await classifyChanges(
      { diff, categories: CATEGORIES, phase1SessionId: "phase1-0" },
      { runClaudeProcess },
    );

    expect(runClaudeProcess).toHaveBeenCalledTimes(4);
    expect(result.categories).toEqual([
      { id: "c1", name: "A", description: "first", attention: "normal" },
      { id: "c2", name: "B", description: "refined", attention: "normal" },
    ]);
    expect(result.assignments.get("b1-0")).toEqual([{ category: "c2", codeType: "production" }]);
  });

  it("sorts the final category list by attention rank, even though escape-hatch categories are appended at the tail mid-run (docs/adr/0010)", async () => {
    // Phase 1 hands in [close, normal, skim], already in presentation order. Escape-hatch.ts
    // appends its accepted category to the tail of the working list without re-sorting (it only
    // sorts once, here, in classifyChanges's final return) — so before this sort, the raw list
    // would be [close, normal, skim, normal(new)], stranding the new "normal" category after
    // "skim". The final result must instead read [close, normal, normal(new), skim]: the badge
    // shown for each category must never disagree with its position.
    const categories: Category[] = [
      { id: "c1", name: "Core", description: "close", attention: "close" },
      { id: "c2", name: "Follow", description: "normal", attention: "normal" },
      { id: "c3", name: "Wiring", description: "skim", attention: "skim" },
    ];
    const diff: ParsedDiff = { files: [fileWithChange("c1")] };

    let call = 0;
    const runClaudeProcess = vi.fn(async (_args: string[], input: string) => {
      call++;
      if (call === 1) {
        return envelope(
          {
            classifications: [
              {
                changeId: "c1",
                assignments: [
                  {
                    category: "none",
                    codeType: "production",
                    suggestedCategory: { name: "D", description: "proposed", attention: "normal" },
                  },
                ],
              },
            ],
          },
          "classifier-1",
        );
      }
      if (call === 2) {
        // consultOnCategory, resuming the phase-1 session — accepted as-is.
        expect(input).toContain("D");
        return envelope(
          { accept: true, category: { name: "D", description: "proposed", attention: "normal" } },
          "phase1-1",
        );
      }
      // Escape-hatch reclassify, using the freshly assigned id "c4".
      expect(input).toContain("c4");
      return envelope(
        {
          classifications: [
            { changeId: "c1", assignments: [{ category: "c4", codeType: "production" }] },
          ],
        },
        "classifier-2",
      );
    });

    const result = await classifyChanges(
      { diff, categories, phase1SessionId: "phase1-0" },
      { runClaudeProcess },
    );

    // Ids stay code-assigned and intact (c4, not renumbered) even though it now sits third —
    // between c2 (normal) and c3 (skim) — rather than at the tail where it was appended.
    expect(result.categories.map((c) => [c.id, c.attention])).toEqual([
      ["c1", "close"],
      ["c2", "normal"],
      ["c4", "normal"],
      ["c3", "skim"],
    ]);
  });
});
