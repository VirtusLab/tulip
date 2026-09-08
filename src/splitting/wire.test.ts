import { describe, expect, it } from "vitest";
import { validateAgainstSchema } from "../claude/schema.js";
import { SPLIT_SCHEMA } from "./wire.js";

describe("SPLIT_SCHEMA", () => {
  it("accepts a valid response", () => {
    const value = {
      splits: [
        { changeId: "src/x.ts:head:1-200", splitBefore: [50, 120] },
        { changeId: "src/x.ts:base:1-5", splitBefore: [] },
      ],
    };
    expect(validateAgainstSchema(value, SPLIT_SCHEMA)).toEqual([]);
  });

  it("rejects a malformed response (splitBefore not integers, changeId missing)", () => {
    const value = { splits: [{ splitBefore: ["nope"] }] };
    expect(validateAgainstSchema(value, SPLIT_SCHEMA).length).toBeGreaterThan(0);
  });
});
