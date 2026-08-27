import { describe, expect, it, vi } from "vitest";
import { createCheckout } from "./checkout.js";
import type { PrRef } from "./pr-url.js";

const PR: PrRef = { owner: "owner", repo: "repo", number: 1 };
const REVISIONS = { base: { sha: "base-sha" }, head: { sha: "head-sha" } };

describe("createCheckout", () => {
  it("inits a repo, adds the origin remote, and shallow-fetches both revisions", async () => {
    const runGit = vi.fn(async () => "");
    const mkdtemp = vi.fn(async () => "/tmp/tulip-abc123");

    await createCheckout(PR, REVISIONS, { runGit, mkdtemp });

    const dir = "/tmp/tulip-abc123";
    expect(runGit).toHaveBeenNthCalledWith(1, ["init"], dir);
    expect(runGit).toHaveBeenNthCalledWith(
      2,
      ["remote", "add", "origin", "https://github.com/owner/repo.git"],
      dir,
    );
    expect(runGit).toHaveBeenNthCalledWith(3, ["fetch", "--depth", "1", "origin", "base-sha"], dir);
    expect(runGit).toHaveBeenNthCalledWith(4, ["fetch", "--depth", "1", "origin", "head-sha"], dir);
  });

  it("reads file content at base and head via git show", async () => {
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === "show" && args[1] === "base-sha:src/a.ts") return "base content";
      if (args[0] === "show" && args[1] === "head-sha:src/a.ts") return "head content";
      return "";
    });
    const checkout = await createCheckout(PR, REVISIONS, {
      runGit,
      mkdtemp: async () => "/tmp/tulip-abc123",
    });

    await expect(checkout.getFileAtBase("src/a.ts")).resolves.toBe("base content");
    await expect(checkout.getFileAtHead("src/a.ts")).resolves.toBe("head content");
  });

  it("returns undefined when the file doesn't exist at that revision", async () => {
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === "show") throw new Error("fatal: path does not exist");
      return "";
    });
    const checkout = await createCheckout(PR, REVISIONS, {
      runGit,
      mkdtemp: async () => "/tmp/tulip-abc123",
    });

    await expect(checkout.getFileAtBase("missing.ts")).resolves.toBeUndefined();
  });

  it("removes the temp dir and rethrows if a git step fails before the checkout is usable", async () => {
    const dir = "/tmp/tulip-abc123";
    const failure = new Error("fatal: could not fetch head sha");
    const runGit = vi.fn(async (args: string[]) => {
      if (args[0] === "fetch" && args.at(-1) === "head-sha") throw failure;
      return "";
    });
    const rm = vi.fn(async () => {});

    await expect(
      createCheckout(PR, REVISIONS, { runGit, mkdtemp: async () => dir, rm }),
    ).rejects.toThrow(failure);

    expect(rm).toHaveBeenCalledTimes(1);
    expect(rm).toHaveBeenCalledWith(dir);
  });

  it("cleanup removes exactly the checkout directory", async () => {
    const runGit = vi.fn(async () => "");
    const rm = vi.fn(async () => {});
    const dir = "/tmp/tulip-abc123";
    const checkout = await createCheckout(PR, REVISIONS, {
      runGit,
      mkdtemp: async () => dir,
      rm,
    });

    await checkout.cleanup();

    expect(rm).toHaveBeenCalledTimes(1);
    expect(rm).toHaveBeenCalledWith(dir);
  });
});
