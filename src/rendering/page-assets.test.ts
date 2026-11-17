import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fontLicenseComment,
  inlineScriptText,
  loadPageAssets,
  mermaidCdnUrl,
  scriptHash,
  subresourceIntegrity,
} from "./page-assets.js";

const FILES: Record<string, string> = {
  "style.css": 'body{} @font-face{src:url("vendor/fonts/inter.woff2") format("woff2")}',
  "vendor/fonts/inter.woff2": "FONT",
  "vendor/fonts/inter.LICENSE.txt": "Copyright Inter\n\nOFL text\n",
  "vendor/mermaid.min.js": "var m='<!-- x -->';",
  "vendor/mermaid.version": "12.3.0\n",
  "vendor/highlight.min.js": "var h=1;",
  "app.js": "var a=2;",
};

const OFFLINE = { offline: true };

const tempDirs: string[] = [];

/** Writes `files` (path relative to the dir → content) into a fresh temp dir. */
async function assetsDirWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tulip-page-assets-"));
  tempDirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

let assetsDir: string;

beforeAll(async () => {
  assetsDir = await assetsDirWith(FILES);
});

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Evaluates `source` as a script and returns its completion value. */
function run(source: string): unknown {
  return new Script(source).runInNewContext();
}

describe("loadPageAssets", () => {
  it("replaces each font reference with a base64 data URI", async () => {
    const { style } = await loadPageAssets(OFFLINE, assetsDir);

    expect(style).toContain(
      `url("data:font/woff2;base64,${Buffer.from("FONT").toString("base64")}")`,
    );
    expect(style).not.toContain("vendor/fonts");
  });

  it("puts the font licenses in a comment before the stylesheet", async () => {
    const { style } = await loadPageAssets(OFFLINE, assetsDir);

    expect(style).toMatch(/^\/\*\nCopyright Inter\n\nOFL text\n\*\/\nbody\{\}/);
  });

  // The real fonts are only vendored by `pnpm build`, so stand-ins are written for whatever the
  // real stylesheet references: this pins the stylesheet's `url()` form, which the CSP's
  // `font-src data:` would block if it weren't embedded.
  it("embeds every font the real stylesheet references", async () => {
    const css = readFileSync(`${import.meta.dirname}/assets/style.css`, "utf8");
    const fonts = [...new Set(withoutComments(css).match(/vendor\/fonts\/[^"')\s]+/g))];
    const dir = await assetsDirWith({
      ...FILES,
      "style.css": css,
      ...Object.fromEntries(
        fonts.flatMap((font) => [
          [font, "FONT"],
          [font.replace(/\.woff2$/, ".LICENSE.txt"), `Copyright ${font}\n\nOFL\n`],
        ]),
      ),
    });

    const { style } = await loadPageAssets(OFFLINE, dir);

    expect(fonts.length).toBeGreaterThan(0);
    expect(withoutComments(style)).not.toContain("vendor/fonts");
    expect(style.match(/data:font\/woff2;base64,/g)).toHaveLength(
      css.match(/@font-face\s*\{/g)?.length ?? 0,
    );
    for (const font of fonts) {
      expect(style).toContain(`Copyright ${font}`);
    }
  });

  it("offline, embeds every script in page order, escaped for an inline <script>", async () => {
    const { scripts } = await loadPageAssets(OFFLINE, assetsDir);

    expect(scripts).toEqual([
      { text: "var m='<\\x21-- x -->';" },
      { text: "var h=1;" },
      { text: "var a=2;" },
    ]);
  });

  it("otherwise loads mermaid from the CDN, pinned to the vendored bundle", async () => {
    const { scripts } = await loadPageAssets({ offline: false }, assetsDir);

    expect(scripts).toEqual([
      {
        src: "https://cdn.jsdelivr.net/npm/mermaid@12.3.0/dist/mermaid.min.js",
        integrity: subresourceIntegrity(Buffer.from("var m='<!-- x -->';")),
      },
      { text: "var h=1;" },
      { text: "var a=2;" },
    ]);
  });
});

describe("fontLicenseComment", () => {
  it("lists the copyright lines of fonts with the same license text above one copy of it", () => {
    expect(fontLicenseComment(["Copyright A\n\nOFL\n", "Copyright B\n\nOFL\n"])).toBe(
      "/*\nCopyright A\nCopyright B\n\nOFL\n*/\n",
    );
  });

  it("keeps each different license text", () => {
    expect(fontLicenseComment(["Copyright A\n\nOFL\n", "Copyright B\n\nMIT\n"])).toBe(
      "/*\nCopyright A\n\nOFL\n\nCopyright B\n\nMIT\n*/\n",
    );
  });

  it("can't end the comment early", () => {
    expect(fontLicenseComment(["Copyright A\n\nx */ y"])).toBe("/*\nCopyright A\n\nx * / y\n*/\n");
  });
});

describe("inlineScriptText", () => {
  it.each([
    ["'</script>'", "'<\\/script>'"],
    ["'</SCRIPT>'", "'<\\/SCRIPT>'"],
    ["'<!--'", "'<\\x21--'"],
    ["'<script>'", "'<script>'"],
    ["a<b && '<div>'", "a<b && '<div>'"],
    ["i<scripts.length", "i<scripts.length"],
    ["a\r\nb\rc", "a\nb\nc"],
  ])("escapes %s", (source, expected) => {
    expect(inlineScriptText(source)).toBe(expected);
  });

  it("keeps the value of a string literal", () => {
    expect(run(inlineScriptText("'<!-- </script> <script>'"))).toBe("<!-- </script> <script>");
  });

  it.each([
    ["a string with a backslash before <", String.raw`"\<!--"`],
    ["a regex with a backslash before <", String.raw`/\<!--/.test("<!--")`],
    ["a /u regex", `/<!--/u.test("<!--")`],
    ["a CRLF-separated script", "var s = '<!--';\r\ns + '</script>'"],
  ])("keeps the meaning of %s", (_, source) => {
    expect(run(inlineScriptText(source))).toEqual(run(source));
  });

  it("rejects a NUL character", () => {
    expect(() => inlineScriptText("'\0'")).toThrow(/NUL/);
  });

  // A match outside a string or regex literal would make the escaped bundle fail to compile.
  it.each([
    ["mermaid", `${import.meta.dirname}/../../node_modules/mermaid/dist/mermaid.min.js`],
    ["highlight.js", `${import.meta.dirname}/assets/vendor/highlight.min.js`],
    ["app.js", `${import.meta.dirname}/assets/app.js`],
  ])("leaves the real %s bundle compilable and free of tag openers", (_, path) => {
    const escaped = inlineScriptText(readFileSync(path, "utf8"));

    expect(() => new Script(escaped)).not.toThrow();
    expect(escaped).not.toMatch(/<\/script|<!--/i);
  });
});

describe("mermaidCdnUrl", () => {
  it.each([
    "12.3",
    "12.3.0 https://evil.example",
    "https://evil.example 12.3.0",
    "12.3.0/../x",
    "",
  ])("refuses %j", (version) => {
    expect(() => mermaidCdnUrl(version)).toThrow(/unexpected mermaid version/);
  });

  it("accepts a prerelease", () => {
    expect(mermaidCdnUrl("12.4.0-rc.1")).toBe(
      "https://cdn.jsdelivr.net/npm/mermaid@12.4.0-rc.1/dist/mermaid.min.js",
    );
  });
});

describe("subresourceIntegrity", () => {
  it("gives the SRI value of a file", () => {
    // `echo -n "alert('Hello, world.');" | openssl dgst -sha384 -binary | openssl base64 -A`
    expect(subresourceIntegrity(Buffer.from("alert('Hello, world.');"))).toBe(
      "sha384-H8BRh8j48O9oYatfu5AZzq6A9RINhZO5H16dQZngK7T62em8MUt1FLm52t+eX6xO",
    );
  });
});

describe("scriptHash", () => {
  it("gives the CSP hash source of a script", () => {
    // The example from MDN's CSP `script-src` page.
    expect(scriptHash("alert('Hello, world.');")).toBe(
      "'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='",
    );
  });
});
