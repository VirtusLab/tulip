import { readFile, rm } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { assembleOutput } from "./assemble.js";

describe("assembleOutput", () => {
  it("writes the page to index.html in a fresh temp dir and copies assets alongside it", async () => {
    const written: { path: string; content: string }[] = [];
    const copied: { src: string; dest: string }[] = [];

    const result = await assembleOutput("<html></html>", {
      mkdtemp: async () => "/tmp/tulip-render-abc",
      writeFile: async (path, content) => {
        written.push({ path, content });
      },
      copyDir: async (src, dest) => {
        copied.push({ src, dest });
      },
      assetsDir: "/fake/assets",
      logger: { info: vi.fn(), debug: vi.fn() },
    });

    expect(result).toEqual({
      dir: "/tmp/tulip-render-abc",
      indexPath: "/tmp/tulip-render-abc/index.html",
    });
    expect(written).toEqual([
      { path: "/tmp/tulip-render-abc/index.html", content: "<html></html>" },
    ]);
    expect(copied).toEqual([{ src: "/fake/assets", dest: "/tmp/tulip-render-abc/assets" }]);
  });

  it("logs how to open the result", async () => {
    const info = vi.fn();
    const result = await assembleOutput("<html></html>", {
      mkdtemp: async () => "/tmp/tulip-render-xyz",
      writeFile: async () => {},
      copyDir: async () => {},
      assetsDir: "/fake/assets",
      logger: { info, debug: vi.fn() },
    });

    expect(info).toHaveBeenCalledWith(expect.stringContaining(`file://${result.indexPath}`));
  });

  it("uses fresh defaults (real fs) when no deps are injected", async () => {
    const result = await assembleOutput("<html>real</html>", {
      logger: { info: vi.fn(), debug: vi.fn() },
    });
    expect(result.dir).toMatch(/tulip-render-/);
    await expect(readFile(result.indexPath, "utf8")).resolves.toBe("<html>real</html>");
    await expect(readFile(`${result.dir}/assets/style.css`, "utf8")).resolves.toContain("body");
    await rm(result.dir, { recursive: true, force: true });
  });
});
