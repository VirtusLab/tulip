/** A full SHA-1 or SHA-256 object name. */
export const COMMIT_SHA_PATTERN = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
