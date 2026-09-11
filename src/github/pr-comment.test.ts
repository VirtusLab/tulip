import { describe, expect, it, vi } from "vitest";
import { postPrComment } from "./pr-comment.js";

const PR_URL = "https://github.com/owner/repo/pull/42";

describe("postPrComment", () => {
  it("posts via gh and returns the trimmed created comment URL", async () => {
    const runGh = vi.fn(async () => "https://github.com/owner/repo/pull/42#issuecomment-1\n");

    const url = await postPrComment(PR_URL, "some body", runGh);

    expect(url).toBe("https://github.com/owner/repo/pull/42#issuecomment-1");
    expect(runGh).toHaveBeenCalledWith(["pr", "comment", PR_URL, "--body", "some body"]);
  });
});
