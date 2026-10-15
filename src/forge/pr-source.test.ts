import { describe, expect, it, vi } from "vitest";
import { config } from "../config.js";
import { fetchConsistentMetadata, type PrContent, type PrRevisions } from "./pr-source.js";
import type { PrRef } from "./types.js";

const PR: PrRef = { forge: "github", host: "github.com", repoPath: "owner/repo", number: 1 };
const CONTENT: PrContent = { title: "t", body: "b", files: ["a.ts"], diff: "d" };

function revisions(headSha: string, base = { ref: "main", sha: "base" }): PrRevisions {
  return { base, head: { ref: "feature", sha: headSha } };
}

/** A source whose revisions are read from `reads` in order, one per `fetchRevisions` call. */
function source(reads: (string | PrRevisions)[]) {
  let call = 0;
  return {
    fetchRevisions: vi.fn(async () => {
      const read = reads[call++] ?? "unexpected";
      return typeof read === "string" ? revisions(read) : read;
    }),
    fetchContent: vi.fn(async () => CONTENT),
  };
}

describe("fetchConsistentMetadata", () => {
  it("returns the content with the revisions read on both sides of it", async () => {
    const result = await fetchConsistentMetadata(source(["h1", "h1"]), PR);

    expect(result).toEqual({ ...CONTENT, ...revisions("h1") });
  });

  it("retries when the revisions changed between the two reads", async () => {
    const src = source(["h1", "h2", "h2", "h2"]);

    const result = await fetchConsistentMetadata(src, PR);

    expect(result.head.sha).toBe("h2");
    expect(src.fetchContent).toHaveBeenCalledTimes(2);
  });

  it("retries when the PR was retargeted to another base branch", async () => {
    const retargeted = revisions("h1", { ref: "release", sha: "base" });
    const src = source(["h1", retargeted, retargeted, retargeted]);

    const result = await fetchConsistentMetadata(src, PR);

    expect(result.base.ref).toBe("release");
    expect(src.fetchContent).toHaveBeenCalledTimes(2);
  });

  it("doesn't retry when only the base branch's SHA moved, and returns the second read's", async () => {
    const moved = revisions("h1", { ref: "main", sha: "base2" });
    const src = source(["h1", moved]);

    const result = await fetchConsistentMetadata(src, PR);

    expect(result.base.sha).toBe("base2");
    expect(src.fetchContent).toHaveBeenCalledTimes(1);
  });

  it("gives up when the revisions keep changing", async () => {
    const heads = Array.from({ length: config.limits.maxPrFetchAttempts * 2 }, (_, i) => `h${i}`);
    const src = source(heads);

    await expect(fetchConsistentMetadata(src, PR)).rejects.toThrow(
      /changed while it was being fetched.*retry/,
    );
    expect(src.fetchContent).toHaveBeenCalledTimes(config.limits.maxPrFetchAttempts);
  });
});
