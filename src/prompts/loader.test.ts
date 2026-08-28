import * as fs from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

import { renderPrompt, templatePlaceholders } from "./loader.js";

describe("renderPrompt", () => {
  it("resolves and loads a real template file, substituting every {{placeholder}}", () => {
    const output = renderPrompt("category-consult", {
      proposedName: "Config parsing",
      path: "src/config.ts",
      range: "10-24",
      excerpt: "+ export function parseConfig() {}",
    });

    expect(output).toContain('named "Config parsing"');
    expect(output).toContain("src/config.ts, lines 10-24");
    expect(output).toContain("+ export function parseConfig() {}");
    expect(output).not.toContain("{{");
  });

  it("throws when a placeholder the template declares is missing from vars", () => {
    expect(() =>
      renderPrompt("category-consult", { proposedName: "X", path: "p", range: "1-2" }),
    ).toThrow(/missing value\(s\) for placeholder\(s\).*excerpt/);
  });

  it("throws when vars supplies a key the template doesn't reference", () => {
    expect(() =>
      renderPrompt("category-consult", {
        proposedName: "X",
        path: "p",
        range: "1-2",
        excerpt: "e",
        extra: "unused",
      }),
    ).toThrow(/var\(s\) supplied but not used.*extra/);
  });

  it("reads the template file only once, caching it across repeated renders", () => {
    renderPrompt("preamble", {}); // ensure it's loaded (may already be cached by module init)
    const before = vi.mocked(fs.readFileSync).mock.calls.length;

    renderPrompt("preamble", {});
    renderPrompt("preamble", {});

    expect(vi.mocked(fs.readFileSync).mock.calls.length).toBe(before);
  });
});

describe("templatePlaceholders", () => {
  it("returns the set of {{placeholder}} names a template declares", () => {
    expect(templatePlaceholders("category-consult")).toEqual(
      new Set(["proposedName", "path", "range", "excerpt"]),
    );
  });

  it("returns an empty set for a template with no placeholders", () => {
    expect(templatePlaceholders("preamble")).toEqual(new Set());
  });
});
