import { describe, expect, it } from "vitest";
import { validateAgainstSchema } from "../claude/schema.js";
import { SPLIT_SCHEMA } from "./wire.js";

describe("SPLIT_SCHEMA", () => {
  it("accepts a valid response with {side, line} boundaries", () => {
    const value = {
      splits: [
        {
          changeId: "src/x.ts:mod:1-60:1-70",
          boundaries: [
            { side: "base", line: 30 },
            { side: "head", line: 40 },
          ],
        },
        { changeId: "src/x.ts:base:1-5", boundaries: [] },
      ],
    };
    expect(validateAgainstSchema(value, SPLIT_SCHEMA)).toEqual([]);
  });

  it("rejects a boundary missing its side or with an unknown side", () => {
    const missingSide = {
      splits: [{ changeId: "src/x.ts:head:1-9", boundaries: [{ line: 3 }] }],
    };
    const badSide = {
      splits: [{ changeId: "src/x.ts:head:1-9", boundaries: [{ side: "left", line: 3 }] }],
    };
    expect(validateAgainstSchema(missingSide, SPLIT_SCHEMA).length).toBeGreaterThan(0);
    expect(validateAgainstSchema(badSide, SPLIT_SCHEMA).length).toBeGreaterThan(0);
  });

  it("rejects a malformed response (changeId missing, boundaries absent)", () => {
    const value = { splits: [{ boundaries: [{ side: "head", line: 1 }] }] };
    expect(validateAgainstSchema(value, SPLIT_SCHEMA).length).toBeGreaterThan(0);
  });
});
