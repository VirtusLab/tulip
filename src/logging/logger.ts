/** Log levels used for phase/progress reporting. */
export type LogLevel = "info" | "debug";

/** Leveled, timestamped console logger. */
export interface Logger {
  /** Reports normal progress (phases, high-level steps). Always shown. */
  info(message: string): void;
  /** Reports fine-grained detail, useful for troubleshooting. Only shown when verbose. */
  debug(message: string): void;
}

export interface LoggerOptions {
  /** Show `debug` messages. Defaults to false. */
  verbose?: boolean;
  /** Clock override, for tests. Defaults to the system clock. */
  now?: () => Date;
  /** Output sink override, for tests. Defaults to `console.log`. */
  write?: (line: string) => void;
}

/** Creates a {@link Logger} that prefixes each line with an ISO timestamp and level. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const verbose = options.verbose ?? false;
  const now = options.now ?? (() => new Date());
  const write = options.write ?? ((line: string) => console.log(line));

  function log(level: LogLevel, message: string): void {
    write(`[${now().toISOString()}] [${level.toUpperCase()}] ${message}`);
  }

  return {
    info: (message) => log("info", message),
    debug: (message) => {
      if (verbose) {
        log("debug", message);
      }
    },
  };
}
