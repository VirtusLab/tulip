import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isProseLanguage, languageForPath, SUPPORTED_LANGUAGES } from "./language.js";

const HLJS_ENTRY_PATH = join(import.meta.dirname, "../../scripts/hljs-entry.mjs");

/** Every language name scripts/hljs-entry.mjs actually registers with highlight.js, parsed out
 * of its source (not imported — it's a build-time esbuild entry point, not a module meant to be
 * loaded in Node/vitest). */
function registeredHljsLanguages(): Set<string> {
  const source = readFileSync(HLJS_ENTRY_PATH, "utf8");
  const names = [...source.matchAll(/hljs\.registerLanguage\("([a-z0-9_-]+)"/g)].map(
    (match) => match[1] as string,
  );
  return new Set(names);
}

describe("languageForPath", () => {
  it.each([
    ["src/app.ts", "typescript"],
    ["src/app.tsx", "typescript"],
    ["src/app.js", "javascript"],
    ["src/app.jsx", "javascript"],
    ["scripts/build.mjs", "javascript"],
    ["main.py", "python"],
    ["lib/thing.rb", "ruby"],
    ["cmd/main.go", "go"],
    ["src/lib.rs", "rust"],
    ["src/Main.java", "java"],
    ["src/App.kt", "kotlin"],
    ["src/util.c", "c"],
    ["src/util.h", "c"],
    ["src/util.cpp", "cpp"],
    ["src/App.cs", "csharp"],
    ["index.php", "php"],
    ["App.swift", "swift"],
    ["Main.scala", "scala"],
    ["deploy.sh", "bash"],
    ["config.yml", "yaml"],
    ["config.yaml", "yaml"],
    ["data.json", "json"],
    ["README.md", "markdown"],
    ["index.html", "xml"],
    ["style.css", "css"],
    ["style.scss", "scss"],
    ["schema.sql", "sql"],
    ["schema.graphql", "graphql"],
    ["Cargo.toml", "ini"],
    ["service.proto", "protobuf"],
  ])("maps %s to %s", (path, expected) => {
    expect(languageForPath(path)).toBe(expected);
  });

  it("is case-insensitive on the extension", () => {
    expect(languageForPath("src/App.TS")).toBe("typescript");
  });

  it("recognizes Dockerfile and Makefile by filename, with no extension", () => {
    expect(languageForPath("Dockerfile")).toBe("dockerfile");
    expect(languageForPath("docker/Dockerfile")).toBe("dockerfile");
    expect(languageForPath("Makefile")).toBe("makefile");
  });

  it("returns undefined for an unknown extension", () => {
    expect(languageForPath("data.xyz123")).toBeUndefined();
  });

  it("returns undefined for a path with no extension", () => {
    expect(languageForPath("LICENSE")).toBeUndefined();
    expect(languageForPath("bin/tool")).toBeUndefined();
  });

  it("does not mistake a dotfile's leading dot for an extension separator", () => {
    expect(languageForPath(".gitignore")).toBeUndefined();
  });
});

describe("isProseLanguage", () => {
  it("treats markdown as prose", () => {
    expect(isProseLanguage("markdown")).toBe(true);
  });

  it("treats an unrecognized/absent language as prose (no code language to preserve alignment for)", () => {
    expect(isProseLanguage(undefined)).toBe(true);
  });

  it.each(["typescript", "javascript", "python", "java", "css", "json"])(
    "treats %s as code, not prose",
    (lang) => {
      expect(isProseLanguage(lang)).toBe(false);
    },
  );
});

describe("SUPPORTED_LANGUAGES / scripts/hljs-entry.mjs drift guard", () => {
  it("maps to exactly the languages the vendored bundle registers — no more, no less", () => {
    // A language mapped here but not registered there means the client asks
    // `hljs.getLanguage(lang)` for something that will never exist (silently disabling
    // highlighting for every file of that language); a language registered there but never
    // mapped here is dead weight in the vendored bundle.
    expect([...SUPPORTED_LANGUAGES].sort()).toEqual([...registeredHljsLanguages()].sort());
  });
});
