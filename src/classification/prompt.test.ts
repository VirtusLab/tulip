import { describe, expect, it } from "vitest";
import type { Category } from "../categories/types.js";
import {
  buildBatchClassifyPrompt,
  buildCoverageRepairPrompt,
  buildEscapeHatchResumePrompt,
  buildInitialClassifyPrompt,
  type EscapeHatchOutcome,
} from "./prompt.js";
import type { ClassifiableChange } from "./types.js";

const CATEGORIES: Category[] = [
  { id: "c1", name: "Retry logic", description: "Adds backoff retries.", attention: "normal" },
  { id: "c2", name: "Logging", description: "Adds structured logs.", attention: "normal" },
];

function change(id: string, excerpt = "+line1\n+line2"): ClassifiableChange {
  return {
    id,
    path: "src/fetch.ts",
    status: "modified",
    head: { range: { start: 10, end: 12 }, lines: [excerpt] },
    excerpt,
  };
}

const BATCH = [change("ch1"), change("ch2", "+onlyline")];

// Byte-identical regression guards (docs/adr/0006): asserts the loader-rendered prompt equals
// the OLD template-literal builder's output for the same inputs. Each case is checked against a
// committed file snapshot (src/classification/__snapshots__/*.txt) — run `vitest -u` to
// regenerate after a deliberate .md wording change.
describe("buildInitialClassifyPrompt", () => {
  it("renders byte-identical prompt output", async () => {
    await expect(buildInitialClassifyPrompt(CATEGORIES, BATCH)).toMatchFileSnapshot(
      "__snapshots__/classify-initial.txt",
    );
  });
});

describe("buildBatchClassifyPrompt", () => {
  it("renders byte-identical prompt output", async () => {
    await expect(buildBatchClassifyPrompt(CATEGORIES, BATCH)).toMatchFileSnapshot(
      "__snapshots__/classify-next-batch.txt",
    );
  });
});

describe("buildEscapeHatchResumePrompt", () => {
  it("renders byte-identical prompt output for an accepted and a rejected outcome", async () => {
    const outcomes: EscapeHatchOutcome[] = [
      {
        change: change("ch1"),
        accepted: true,
        category: {
          id: "c3",
          name: "New area",
          description: "Escape-hatch addition.",
          attention: "normal",
        },
      },
      {
        change: change("ch2"),
        accepted: false,
      },
    ];

    await expect(buildEscapeHatchResumePrompt(CATEGORIES, outcomes)).toMatchFileSnapshot(
      "__snapshots__/classify-escape-hatch.txt",
    );
  });
});

describe("buildCoverageRepairPrompt", () => {
  it("renders byte-identical prompt output", async () => {
    await expect(buildCoverageRepairPrompt(CATEGORIES, BATCH)).toMatchFileSnapshot(
      "__snapshots__/classify-coverage-repair.txt",
    );
  });
});
