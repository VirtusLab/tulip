/**
 * Minimal JSON Schema subset: object/array/string/number/integer/boolean/null, nested
 * `properties`/`items`, `required`, `enum`. Passed through to `claude --json-schema` as-is,
 * and also used locally by {@link validateAgainstSchema} for lightweight response validation —
 * not a full JSON Schema implementation, just enough to catch a model emitting the wrong shape.
 */
export interface JsonSchema {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  [key: string]: unknown;
}

/**
 * Checks `value` against `schema` (required properties + types, recursively through
 * `properties`/`items`). Returns human-readable error descriptions; an empty array means valid.
 */
export function validateAgainstSchema(value: unknown, schema: JsonSchema, path = "$"): string[] {
  const errors: string[] = [];

  if (schema.enum !== undefined && !schema.enum.some((allowed) => deepEqual(allowed, value))) {
    errors.push(
      `${path}: expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`,
    );
  }

  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    errors.push(`${path}: expected type "${schema.type}", got ${describeType(value)}`);
    return errors; // further checks assume the value has the right shape
  }

  if (schema.type === "object" && isPlainObject(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) {
        errors.push(`${path}: missing required property "${key}"`);
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) {
        errors.push(...validateAgainstSchema(value[key], propSchema, `${path}.${key}`));
      }
    }
  }

  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    const itemSchema = schema.items;
    value.forEach((item, index) => {
      errors.push(...validateAgainstSchema(item, itemSchema, `${path}[${index}]`));
    });
  }

  return errors;
}

function matchesType(value: unknown, type: NonNullable<JsonSchema["type"]>): boolean {
  switch (type) {
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
