/** Formats a duration for progress lines: `"45s"`, `"1m3s"`, `"1h2m"` — coarser units the
 * longer it gets, since a multi-hour run has no use for seconds. Rounds to the nearest second. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m${totalSeconds % 60}s`;
  }
  return `${Math.floor(totalMinutes / 60)}h${totalMinutes % 60}m`;
}

/** Starts a timer; the returned function gives the elapsed time so far via {@link formatDuration}.
 * `now` is a clock override for tests. */
export function startTimer(now: () => number = Date.now): () => string {
  const startedAt = now();
  return () => formatDuration(now() - startedAt);
}
