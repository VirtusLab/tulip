#!/usr/bin/env node

import { run } from "../pipeline/run.js";
import { CliUsageError, HelpRequestedError, parseCliArgs, usage } from "./args.js";

async function main(): Promise<void> {
  let options: ReturnType<typeof parseCliArgs>;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof HelpRequestedError) {
      console.log(usage());
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

  await run(options);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`tulip: ${message}`);
  process.exitCode = 1;
});
