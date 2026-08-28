import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Dual-mode check (docs/adr/0006): `pnpm build` copies src/prompts/*.md next to the compiled
 * dist/prompts/loader.js (see scripts/copy-assets.mjs) — this guards against that step
 * regressing, so a real `tulip` run from `dist/` doesn't silently fail to find its prompts.
 * Skipped when `dist/` doesn't exist (e.g. running tests without building first); the repo's
 * required flow is `pnpm build && pnpm test`, so this normally runs for real.
 */
const SRC_PROMPTS_DIR = fileURLToPath(new URL(".", import.meta.url));
const DIST_LOADER = fileURLToPath(new URL("../../dist/prompts/loader.js", import.meta.url));
const DIST_PROMPTS_DIR = fileURLToPath(new URL("../../dist/prompts/", import.meta.url));

const builtDist = existsSync(DIST_LOADER);

describe.runIf(builtDist)("dist/prompts (after pnpm build)", () => {
  it("copies every src/prompts/*.md file next to the compiled loader", () => {
    const srcTemplates = readdirSync(SRC_PROMPTS_DIR).filter((name) => name.endsWith(".md"));
    const distTemplates = readdirSync(DIST_PROMPTS_DIR).filter((name) => name.endsWith(".md"));

    expect(distTemplates.sort()).toEqual(srcTemplates.sort());
  });

  it("resolves and renders a real template from the compiled dist loader", async () => {
    const { renderPrompt } = await import(DIST_LOADER);

    expect(renderPrompt("preamble", {})).toBe(
      "Be short and to the point. Avoid jargon and use simple words. " +
        "Explain facts in simple terms — don't try to sound smart.",
    );
  });
});

describe.runIf(!builtDist)("dist/prompts (skipped — no build found)", () => {
  it("run `pnpm build` first to exercise the dist/prompts checks above", () => {
    expect(builtDist).toBe(false);
  });
});
