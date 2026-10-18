import { describe, expect, it } from "vitest";
import { type JsonSchema, validateAgainstSchema } from "./schema.js";

const CATEGORY_SCHEMA: JsonSchema = {
  type: "object",
  required: ["categories"],
  properties: {
    categories: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
    },
  },
};

describe("validateAgainstSchema", () => {
  it("returns no errors for a valid value", () => {
    expect(validateAgainstSchema({ categories: [{ name: "auth" }] }, CATEGORY_SCHEMA)).toEqual([]);
  });

  it("reports a missing required property", () => {
    expect(validateAgainstSchema({}, CATEGORY_SCHEMA)).toEqual([
      '$: missing required property "categories"',
    ]);
  });

  it("reports a wrong top-level type", () => {
    expect(validateAgainstSchema("not an object", CATEGORY_SCHEMA)).toEqual([
      '$: expected type "object", got string',
    ]);
  });

  it("recurses into array items and nested properties", () => {
    expect(validateAgainstSchema({ categories: [{ name: 42 }] }, CATEGORY_SCHEMA)).toEqual([
      '$.categories[0].name: expected type "string", got number',
    ]);
  });

  it("rejects a value outside an enum", () => {
    const schema: JsonSchema = { type: "string", enum: ["production", "test"] };

    expect(validateAgainstSchema("docs", schema)).toEqual([
      '$: expected one of ["production","test"], got "docs"',
    ]);
  });
});
