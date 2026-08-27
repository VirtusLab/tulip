import { config } from "../config.js";

/** Runs work under a concurrency cap, queuing excess calls FIFO. */
export interface ConcurrencyLimiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/** A simple promise-based semaphore: at most `limit` calls to `run` are in flight at once. */
export function createConcurrencyLimiter(limit: number): ConcurrencyLimiter {
  let active = 0;
  const queue: Array<() => void> = [];

  function admitNext(): void {
    if (active >= limit) {
      return;
    }
    const admit = queue.shift();
    if (!admit) {
      return;
    }
    active++;
    admit();
  }

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      queue.push(resolve);
      admitNext();
    });
    try {
      return await fn();
    } finally {
      active--;
      admitNext();
    }
  }

  return { run };
}

/** Shared by every `claude` invocation the tool spawns — see runner.ts's `execute`. */
export const claudeConcurrencyLimiter: ConcurrencyLimiter = createConcurrencyLimiter(
  config.limits.maxConcurrentClaudeProcesses,
);
