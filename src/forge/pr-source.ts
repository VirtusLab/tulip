import { config } from "../config.js";
import type { PrMetadata, PrRef } from "./types.js";

/** A PR's base and head branches with their commit SHAs. */
export type PrRevisions = Pick<PrMetadata, "base" | "head">;

/** A PR's title, description, changed files and diff, without the revisions they belong to. */
export type PrContent = Omit<PrMetadata, "base" | "head">;

/** One way of reading a PR from its forge (an API or a CLI). Each operation rejects with a message
 * naming the forge or tool. */
export interface PrSource {
  fetchRevisions(pr: PrRef): Promise<PrRevisions>;
  fetchContent(pr: PrRef): Promise<PrContent>;
}

/**
 * Fetches a PR's metadata from `source` such that the diff and file list belong to the returned
 * head SHA: the whole fetch is repeated (up to {@link config}.limits.maxPrFetchAttempts times) if
 * a push or retarget happened while it ran. A move of the base branch alone doesn't count.
 */
export async function fetchConsistentMetadata(source: PrSource, pr: PrRef): Promise<PrMetadata> {
  for (let attempt = 0; attempt < config.limits.maxPrFetchAttempts; attempt++) {
    const before = await source.fetchRevisions(pr);
    const content = await source.fetchContent(pr);
    const after = await source.fetchRevisions(pr);
    if (sameRevisions(before, after)) {
      return { ...content, ...after };
    }
  }
  throw new Error(
    `The PR changed while it was being fetched, ${config.limits.maxPrFetchAttempts} times in a row; retry`,
  );
}

// Not base.sha: on GitHub it is the base branch's tip, which moves with unrelated pushes.
function sameRevisions(a: PrRevisions, b: PrRevisions): boolean {
  return a.base.ref === b.base.ref && a.head.ref === b.head.ref && a.head.sha === b.head.sha;
}
