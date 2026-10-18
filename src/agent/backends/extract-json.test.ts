import { describe, expect, it } from "vitest";
import { extractJson } from "./extract-json.js";

describe("extractJson", () => {
  it("parses a bare JSON reply", () => {
    expect(extractJson('  {"a": [1, 2]}\n')).toEqual({ a: [1, 2] });
  });

  it("parses a fenced block, preferring the last one", () => {
    const text = 'Example:\n```json\n{"a": 1}\n```\nFinal:\n```json\n{"a": 2}\n```\n';

    expect(extractJson(text)).toEqual({ a: 2 });
  });

  it("parses an object after prose from earlier assistant messages", () => {
    expect(extractJson('I\'ll read the file.{"ok": true, "note": "a } in a string"}')).toEqual({
      ok: true,
      note: "a } in a string",
    });
  });

  it("skips an unbalanced brace in the prose before the object", () => {
    expect(extractJson('The function `f() {` changed. {"ok": false}')).toEqual({ ok: false });
  });

  it("skips a balanced non-JSON span whole, without parsing its inner braces", () => {
    expect(extractJson('Saw {a {"inner": 1} b} then {"ok": true}')).toEqual({ ok: true });
  });

  it("returns undefined when nothing parses", () => {
    expect(extractJson("no json { here")).toBeUndefined();
    expect(extractJson("")).toBeUndefined();
  });
});
