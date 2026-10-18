import { describe, expect, it } from "vitest";
import { type JsonSchema, validateAgainstSchema } from "../schema.js";
import { stripOptionalNulls, toStrictSchema } from "./codex-schema.js";

const CATEGORY: JsonSchema = {
  type: "object",
  required: ["name"],
  properties: { name: { type: "string" }, note: { type: "string" } },
};

const SCHEMA: JsonSchema = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["side"],
        properties: {
          side: { enum: ["base", "head"] },
          category: CATEGORY,
        },
      },
    },
    count: { type: "integer" },
  },
};

describe("toStrictSchema", () => {
  it("closes every object, requires every property, and makes optional ones nullable", () => {
    expect(toStrictSchema(SCHEMA)).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["items", "count"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["side", "category"],
            properties: {
              side: { enum: ["base", "head"] },
              category: {
                anyOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["name", "note"],
                    properties: {
                      name: { type: "string" },
                      note: { anyOf: [{ type: "string" }, { type: "null" }] },
                    },
                  },
                  { type: "null" },
                ],
              },
            },
          },
        },
        count: { anyOf: [{ type: "integer" }, { type: "null" }] },
      },
    });
  });

  it('closes an object given by `properties` alone, without `type: "object"`', () => {
    expect(toStrictSchema({ properties: { a: { type: "string" } }, required: ["a"] })).toEqual({
      properties: { a: { type: "string" } },
      required: ["a"],
      additionalProperties: false,
    });
  });

  it("leaves the original schema untouched", () => {
    const before = JSON.stringify(SCHEMA);
    toStrictSchema(SCHEMA);
    expect(JSON.stringify(SCHEMA)).toBe(before);
  });
});

describe("stripOptionalNulls", () => {
  it("drops nulls the strict schema forced onto optional properties, at any depth", () => {
    const reply = {
      items: [
        { side: "head", category: null },
        { side: "base", category: { name: "x", note: null } },
      ],
      count: null,
    };

    const stripped = stripOptionalNulls(reply, SCHEMA);

    expect(stripped).toEqual({
      items: [{ side: "head" }, { side: "base", category: { name: "x" } }],
    });
    expect(validateAgainstSchema(stripped, SCHEMA)).toEqual([]);
  });

  it("keeps keys the schema doesn't declare, nulls included", () => {
    expect(stripOptionalNulls({ items: [], extra: null }, SCHEMA)).toEqual({
      items: [],
      extra: null,
    });
  });

  it("keeps a null in a required property, so validation still rejects it", () => {
    const stripped = stripOptionalNulls({ items: null }, SCHEMA);

    expect(stripped).toEqual({ items: null });
    expect(validateAgainstSchema(stripped, SCHEMA)).not.toEqual([]);
  });
});
