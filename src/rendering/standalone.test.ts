import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadInlineAssets, PAGE_SCRIPTS, scriptHash } from "./standalone.js";

let assetsDir: string;

beforeEach(async () => {
  assetsDir = await mkdtemp(join(tmpdir(), "tulip-assets-"));
  await mkdir(join(assetsDir, "vendor/fonts"), { recursive: true });
  await writeFile(
    join(assetsDir, "style.css"),
    '@font-face { src: url("vendor/fonts/a.woff2") format("woff2"); }\nbody { color: red; }',
  );
  await writeFile(join(assetsDir, "vendor/fonts/a.woff2"), Buffer.from([1, 2, 3]));
  for (const [index, path] of PAGE_SCRIPTS.entries()) {
    await writeFile(
      join(assetsDir, path),
      index === 0 ? 'var m = "</script><!--";' : `var s${index};`,
    );
  }
});

afterEach(async () => {
  await rm(assetsDir, { recursive: true, force: true });
});

describe("loadInlineAssets", () => {
  it("embeds fonts in the stylesheet as data: URLs", async () => {
    const { css } = await loadInlineAssets(assetsDir);

    expect(css).toContain('url("data:font/woff2;base64,AQID")');
    expect(css).not.toContain("vendor/fonts");
    expect(css).toContain("body { color: red; }");
  });

  it("returns the scripts in load order, unable to close their element or open a comment", async () => {
    const { scripts } = await loadInlineAssets(assetsDir);

    expect(scripts).toEqual(['var m = "<\\/script><\\x21--";', "var s1;", "var s2;"]);
  });
});

describe("inlined scripts", () => {
  it("still parse and mean the same, unicode regexes and CRLF line endings included", async () => {
    const source =
      'var r = /<!--|<\\/script>/u;\r\nvar s = "</script><!--";\r\nglobalThis.out = [r.test("<!--"), s];';
    await writeFile(join(assetsDir, PAGE_SCRIPTS[0] as string), source);

    const [inlined] = (await loadInlineAssets(assetsDir)).scripts;
    const context: { out?: unknown } = {};
    runInNewContext(inlined as string, context);

    expect(inlined).not.toMatch(/<\/script|<!--|\r/i);
    expect(context.out).toEqual([true, "</script><!--"]);
  });
});

describe("scriptHash", () => {
  it("is a CSP sha256 source for the exact script text", () => {
    expect(scriptHash("var a = 2;")).toBe("'sha256-oz/OuKcOxkE/vYkET0ay9YXAfqAbMNvCwZ6sGfZTlyU='");
  });
});
