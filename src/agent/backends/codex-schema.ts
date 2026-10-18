import { isPlainObject, type JsonSchema } from "../schema.js";

/**
 * A copy of `schema` that `codex exec --output-schema` accepts. Codex sends it to OpenAI in strict
 * mode, which rejects any object without `additionalProperties: false` or with a property missing
 * from `required`. So every object is closed and requires all its properties; one that was
 * optional becomes nullable instead. {@link stripOptionalNulls} undoes that on the reply.
 */
export function toStrictSchema(schema: JsonSchema): JsonSchema {
  const strict: JsonSchema = { ...schema };
  if (schema.items) {
    strict.items = toStrictSchema(schema.items);
  }
  if (schema.type === "object" || schema.properties) {
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    strict.additionalProperties = false;
    strict.required = Object.keys(properties);
    strict.properties = Object.fromEntries(
      Object.entries(properties).map(([key, property]) => {
        const converted = toStrictSchema(property);
        return [key, required.has(key) ? converted : { anyOf: [converted, { type: "null" }] }];
      }),
    );
  }
  return strict;
}

/** `value` without the `null`s that {@link toStrictSchema} let the model put in properties
 * `schema` marks optional, so it validates against `schema` as an omitted property would. */
export function stripOptionalNulls(value: unknown, schema: JsonSchema): unknown {
  if (Array.isArray(value) && schema.items) {
    const itemSchema = schema.items;
    return value.map((item) => stripOptionalNulls(item, itemSchema));
  }
  if (!isPlainObject(value) || !schema.properties) {
    return value;
  }
  const required = new Set(schema.required ?? []);
  const result: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    const property = schema.properties[key];
    if (property === undefined) {
      result[key] = fieldValue;
    } else if (fieldValue !== null || required.has(key)) {
      result[key] = stripOptionalNulls(fieldValue, property);
    }
  }
  return result;
}
