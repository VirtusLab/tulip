import { describe, expect, it } from "vitest";
import type { Category } from "../categories/types.js";
import {
  GOLDEN_CLASSIFY_BATCH,
  GOLDEN_CLASSIFY_COVERAGEREPAIR,
  GOLDEN_CLASSIFY_ESCAPEHATCH,
  GOLDEN_CLASSIFY_INITIAL,
} from "../prompts/__fixtures__/golden.js";
import {
  buildBatchClassifyPrompt,
  buildCoverageRepairPrompt,
  buildEscapeHatchResumePrompt,
  buildInitialClassifyPrompt,
  type EscapeHatchOutcome,
} from "./prompt.js";
import type { ClassifiableChange } from "./types.js";

const CATEGORIES: Category[] = [
  { id: "c1", name: "Retry logic", description: "Adds backoff retries." },
  { id: "c2", name: "Logging", description: "Adds structured logs." },
];

function change(id: string, excerpt = "+line1\n+line2"): ClassifiableChange {
  return {
    id,
    path: "src/fetch.ts",
    status: "modified",
    side: "head",
    range: { start: 10, end: 12 },
    excerpt,
    lines: [excerpt],
  };
}

const BATCH = [change("ch1"), change("ch2", "+onlyline")];

// Byte-identical regression guards (docs/adr/0006): asserts the loader-rendered prompt equals
// the OLD template-literal builder's output for the same inputs, captured before the refactor.
describe("buildInitialClassifyPrompt", () => {
  it("renders byte-identical prompt output", () => {
    expect(buildInitialClassifyPrompt(CATEGORIES, BATCH)).toBe(GOLDEN_CLASSIFY_INITIAL);
  });
});

describe("buildBatchClassifyPrompt", () => {
  it("renders byte-identical prompt output", () => {
    expect(buildBatchClassifyPrompt(CATEGORIES, BATCH)).toBe(GOLDEN_CLASSIFY_BATCH);
  });
});

describe("buildEscapeHatchResumePrompt", () => {
  it("renders byte-identical prompt output for an accepted and a rejected outcome", () => {
    const outcomes: EscapeHatchOutcome[] = [
      {
        change: change("ch1"),
        accepted: true,
        category: { id: "c3", name: "New area", description: "Escape-hatch addition." },
      },
      {
        change: change("ch2"),
        accepted: false,
      },
    ];

    expect(buildEscapeHatchResumePrompt(CATEGORIES, outcomes)).toBe(GOLDEN_CLASSIFY_ESCAPEHATCH);
  });
});

describe("buildCoverageRepairPrompt", () => {
  it("renders byte-identical prompt output", () => {
    expect(buildCoverageRepairPrompt(CATEGORIES, BATCH)).toBe(GOLDEN_CLASSIFY_COVERAGEREPAIR);
  });
});
