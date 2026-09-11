import { runCommand } from "./exec.js";

/** Runs a `gh` subcommand (e.g. `["pr", "view", ...]`) and returns its stdout. Mockable in tests. */
export type CommandRunner = (args: string[]) => Promise<string>;

/** Invokes the `gh` binary on PATH. The default {@link CommandRunner} for the gh wrappers. */
export const defaultRunGh: CommandRunner = (args) => runCommand("gh", args);
