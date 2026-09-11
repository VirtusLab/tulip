import { type CommandRunner, defaultRunGh } from "./gh.js";

/**
 * Posts `body` as a comment on the PR at `prUrl` via `gh pr comment`. `body` is passed as a single
 * argv element (no shell), so it's injection-safe. Returns the created comment's URL.
 */
export async function postPrComment(
  prUrl: string,
  body: string,
  runGh: CommandRunner = defaultRunGh,
): Promise<string> {
  const stdout = await runGh(["pr", "comment", prUrl, "--body", body]);
  return stdout.trim();
}
