# 29. Per-call statistics log

## Context

Runs are costly, and the end-of-run token table only gives totals per model. To find what to
make cheaper we need cost per pipeline step, per category, and per amend or fix round. The
`claude` CLI's own session transcripts don't give this: they don't name the step, they mix
resumes into one file, they exist only for `claude`, and nothing guarantees they are kept.

## Decision

- Every run appends records to `$TMPDIR/tulip-calls-<timestamp>-<pid>.jsonl`
  (`src/agent/call-log.ts`) and logs its path at the end.
- Records: `run` (version, agent, PR, diff size), `categories` (name, attention, change counts),
  one `call` per agent process, and `end` (success, wall time, error). `end` is written before a
  `--serve` server starts, so its wall time excludes the server.
- A `call` record holds the call's label, model, tier, session ids, prompt size, wall time,
  tokens, turns and cost (the last three when the CLI reports them), and the error if it failed.
  Schema retries are their own records, flagged `schemaRetry`. `claude` reports a resume's cost
  as the session's running total, so the log records the increase over the previous call.
- `runSession`/`resumeSession` require a `label`: `step` (e.g. `explain`, `review-amend`,
  `mermaid-fix`), plus `category`, `batch` or `attempt` where they apply.
- Records are written as they come, so a failed run keeps them. A write error is logged once and
  never fails the run.

## Consequences

- Cost can be broken down by step and category with `jq` over one or many runs.
- A new LLM call site must pick a step name.
- Files pile up in the temp dir until the OS clears it.
