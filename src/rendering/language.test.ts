import { describe, expect, it } from "vitest";
import { languageForPath } from "./language.js";

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
