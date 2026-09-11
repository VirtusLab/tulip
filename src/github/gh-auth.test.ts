import { describe, expect, it, vi } from "vitest";
import { checkGhAuth } from "./gh-auth.js";

const HOST = "github.com";

describe("checkGhAuth", () => {
  it("resolves when gh auth status succeeds", async () => {
    const runGh = vi.fn(async () => "Logged in\n");

    await expect(checkGhAuth(HOST, runGh)).resolves.toBeUndefined();

    expect(runGh).toHaveBeenCalledWith(["auth", "status", "--hostname", HOST]);
  });

  it("throws a not-found error when gh is missing (ENOENT)", async () => {
    const runGh = vi.fn(async () => {
      throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
    });

    await expect(checkGhAuth(HOST, runGh)).rejects.toThrow(/gh CLI not found/);
    await expect(checkGhAuth(HOST, runGh)).rejects.not.toThrow(/not authenticated/);
  });

  it("throws an auth error when gh exits non-zero", async () => {
    const runGh = vi.fn(async () => {
      throw Object.assign(new Error("exit 1"), { code: 1 });
    });

    await expect(checkGhAuth("git.xyz.com", runGh)).rejects.toThrow(
      /not authenticated for git\.xyz\.com/,
    );
    await expect(checkGhAuth("git.xyz.com", runGh)).rejects.toThrow(/gh auth login/);
  });
});
