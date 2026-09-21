import { describe, expect, it } from "vitest";
import { findFences } from "./fences.js";

describe("findFences", () => {
  it("finds a backtick fence with its info string, content and span", () => {
    const markdown = "Before.\n\n```ts\nconst x = 1;\n```\n\nAfter.\n";
    const fences = findFences(markdown);
    expect(fences).toHaveLength(1);
    expect(fences[0]?.info).toBe("ts");
    expect(fences[0]?.content).toBe("const x = 1;");
    expect(markdown.slice(fences[0]?.start, fences[0]?.end)).toBe("```ts\nconst x = 1;\n```");
  });

  it("finds a tilde fence, and every fence in document order", () => {
    const fences = findFences("~~~\na\n~~~\n\n```\nb\n```\n");
    expect(fences.map((fence) => fence.content)).toEqual(["a", "b"]);
  });

  it("reports an empty info string when the opener carries none", () => {
    expect(findFences("```\na\n```\n")[0]?.info).toBe("");
  });

  it("trims the info string", () => {
    expect(findFences("~~~  mermaid  \na\n~~~\n")[0]?.info).toBe("mermaid");
  });

  it("allows up to three spaces of indent, but not four, and not a tab", () => {
    expect(findFences("   ```\na\n   ```\n")).toHaveLength(1);
    expect(findFences("    ```\na\n    ```\n")).toEqual([]);
    expect(findFences("\t```\na\n\t```\n")).toEqual([]);
  });

  it("strips the opener's indent from every content line", () => {
    expect(findFences("  ```ts\n  a\n    b\n  ```\n")[0]?.content).toBe("a\n  b");
  });

  it("closes on a longer fence, but not on a shorter one", () => {
    expect(findFences("```\na\n`````\n").map((fence) => fence.content)).toEqual(["a"]);
    expect(findFences("`````\na\n```\nb\n`````\n").map((fence) => fence.content)).toEqual([
      "a\n```\nb",
    ]);
  });

  it("closes on a fence line with trailing whitespace", () => {
    expect(findFences("```\na\n```  \n").map((fence) => fence.content)).toEqual(["a"]);
  });

  it("does not close on a fence line that carries an info string", () => {
    expect(findFences("```\na\n```js\nb\n```\n").map((fence) => fence.content)).toEqual([
      "a\n```js\nb",
    ]);
  });

  it("keeps a tilde line inside a backtick fence as content", () => {
    expect(findFences("```\n~~~\n```\n").map((fence) => fence.content)).toEqual(["~~~"]);
  });

  it("keeps a shorter fence wrapped in a longer one as content", () => {
    const fences = findFences("````\n```\ninner\n```\n````\n");
    expect(fences).toHaveLength(1);
    expect(fences[0]?.content).toBe("```\ninner\n```");
  });

  it("ignores a backtick opener whose info string contains a backtick", () => {
    expect(findFences("``` `js`\n")).toEqual([]);
  });

  it("runs an unterminated fence to the end of the input", () => {
    const markdown = "Before.\n\n```\nnever closed\n";
    const fences = findFences(markdown);
    expect(fences).toHaveLength(1);
    expect(fences[0]?.end).toBe(markdown.length);
    expect(fences[0]?.content).toBe("never closed");
  });

  it("opens a fence on a last line that has no trailing newline", () => {
    const markdown = "text\n```";
    const fences = findFences(markdown);
    expect(fences).toHaveLength(1);
    expect(fences[0]?.content).toBe("");
    expect(fences[0]?.end).toBe(markdown.length);
  });

  it("computes offsets over CRLF line endings", () => {
    const markdown = "Before.\r\n\r\n```ts\r\na\r\n```\r\n";
    const fences = findFences(markdown);
    expect(markdown.slice(fences[0]?.start, fences[0]?.end)).toBe("```ts\r\na\r\n```");
    expect(fences[0]?.info).toBe("ts");
    expect(fences[0]?.content).toBe("a");
  });

  it("returns nothing when there are no fences", () => {
    expect(findFences("just prose\n")).toEqual([]);
  });
});
