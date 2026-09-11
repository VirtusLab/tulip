import { type CommandRunner, defaultRunGh } from "./gh.js";

/**
 * Preflight check that `gh` is installed and authenticated for `host`, via `gh auth status`.
 * Resolves when authenticated. Throws a user-actionable Error if `gh` is missing (ENOENT) or not
 * authenticated for the host — used before serve mode, which has no posting fallback.
 */
export async function checkGhAuth(
  host: string,
  runGh: CommandRunner = defaultRunGh,
): Promise<void> {
  try {
    await runGh(["auth", "status", "--hostname", host]);
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") {
      throw new Error("gh CLI not found; install it or run without --serve");
    }
    throw new Error(
      `gh is not authenticated for ${host}; run \`gh auth login --hostname ${host}\``,
    );
  }
}
