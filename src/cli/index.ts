#!/usr/bin/env node

import { createLogger } from "../logging/logger.js";
import { run } from "../pipeline/run.js";
import { shareRun } from "../share/share.js";
import { shareKeyPath } from "../share/signing.js";
import { formatVersion } from "../version.js";
import { resolveAgent } from "./agent-choice.js";
import {
  CliUsageError,
  HelpRequestedError,
  parseCliArgs,
  parseShareArgs,
  usage,
  VersionRequestedError,
} from "./args.js";
import { userSettingsPath } from "./settings.js";

async function main(): Promise<void> {
  // Before parseCliArgs and resolveAgent: sharing runs no agent, so it never asks for one.
  if (process.argv[2] === "share") {
    await shareMain(process.argv.slice(3));
    return;
  }

  let options: ReturnType<typeof parseCliArgs>;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof HelpRequestedError) {
      console.log(usage());
      process.exitCode = 0;
      return;
    }
    if (error instanceof VersionRequestedError) {
      console.log(formatVersion());
      process.exitCode = 0;
      return;
    }
    if (error instanceof CliUsageError) {
      console.error(`tulip: ${error.message}\n`);
      console.error(usage());
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const agent = await resolveAgent(options.agent, {
    settingsPath: userSettingsPath(),
    log: (line) => console.log(line),
  });
  await run({ ...options, agent, shareKeyPath: shareKeyPath(userSettingsPath()) });
}

async function shareMain(argv: string[]): Promise<void> {
  let options: ReturnType<typeof parseShareArgs>;
  try {
    options = parseShareArgs(argv);
  } catch (error) {
    if (error instanceof HelpRequestedError) {
      console.log(usage());
      return;
    }
    if (error instanceof CliUsageError) {
      console.error(`tulip: ${error.message}\n`);
      console.error(usage());
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  await shareRun(options.location, shareKeyPath(userSettingsPath()), {
    logger: createLogger({ verbose: options.verbose }),
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`tulip: ${message}`);
  process.exitCode = 1;
});
