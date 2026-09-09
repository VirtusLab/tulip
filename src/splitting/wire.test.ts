import { describe, expect, it } from "vitest";
import { validateAgainstSchema } from "../claude/schema.js";
import { SPLIT_SCHEMA } from "./wire.js";

describe("SPLIT_SCHEMA", () => {
  it("accepts a valid response with single-sided and paired boundaries", () => {
    const value = {
      splits: [
        { changeId: "src/x.ts:head:1-200", boundaries: [{ head: 50 }, { head: 120 }] },
        { changeId: "src/x.ts:mod:1-60:1-70", boundaries: [{ base: 30, head: 40 }] },
        { changeId: "src/x.ts:base:1-5", boundaries: [] },
      ],
    };
    expect(validateAgainstSchema(value, SPLIT_SCHEMA)).toEqual([]);
  });

  it("rejects a malformed response (changeId missing, boundaries absent)", () => {
    const value = { splits: [{ boundaries: [{ head: 1 }] }] };
    expect(validateAgainstSchema(value, SPLIT_SCHEMA).length).toBeGreaterThan(0);
  });
});
