# 26. Pluggable agent backends

## Context

Every LLM pass ran through the headless `claude` CLI, and `src/claude/` mixed two kinds of
code: the generic parts (retry on invalid output, schema validation, the concurrency cap, the
usage ledger, sessions) and the Claude-specific parts (argv, the `--json-schema` envelope, the
`haiku`/`sonnet`/`opus` aliases). Supporting a second CLI, starting with Cursor's `agent`,
needs a seam between them that a third CLI can reuse.

The two CLIs differ in ways that matter here. These were checked against `agent --help`,
Cursor's output-format docs, and live `agent -p` runs (CLI version 2026.10.14):

- **Structured output.** `claude` has `--json-schema` and returns `structured_output`. `agent`
  has neither: its `--output-format json` envelope carries `result` (the text), `session_id`,
  `duration_ms`, and, although the docs omit it, a camelCase `usage` object (`inputTokens`,
  `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`). `result` concatenates every
  assistant message of the turn, e.g. `I'll read the file.{...}`.
- **Prompt delivery.** `agent -p` reads the prompt from piped stdin, as `claude -p` does, so
  large prompts still avoid the argv size limit.
- **Tools.** `agent -p` grants write and shell tools by default. `--mode ask` is read-only. In
  a live run, the model in ask mode read a file but made no write or shell call, even when the
  prompt told it to.
- **Workspace trust.** A headless run in an untrusted directory (the fresh temp checkout)
  aborts with "Workspace Trust Required" unless `--trust` is given. With `--trust`, a project's
  `.cursor/hooks.json` hooks ran (`sessionStart`, `beforeReadFile`), and so did Claude Code
  hooks in `.claude/settings.json` (`SessionStart`, `PreToolUse`), which Cursor also honors. A
  malicious PR could ship either file and get arbitrary command execution.
- **Sessions.** `agent -p --resume <session_id>` continues the session from the JSON output.

## Decision

- **`src/claude/` becomes `src/agent/`** with generic names (`invokeAgent`,
  `AgentProcessRunner`, `Agent*Error`, `agentConcurrencyLimiter`, `RunnerDeps.runAgentProcess`).
  The generic retry, validation, concurrency, usage, and session code stays there.
- **`AgentBackend`** (`src/agent/backend.ts`) holds what differs per CLI: `bin`, `installHint`,
  `modelFor(tier)`, `planSpawn` (argv, the stdin prompt, and any files for one call),
  `parseReply` (stdout to a normalized `AgentReply` with `structured`, `usage`, turns,
  duration), and an optional `prepareWorkspace(dir)`. Backends live in `src/agent/backends/`.
  Adding a CLI means adding a backend, a config entry, and its id in `AGENT_IDS` and `BACKENDS`
  (src/agent/backend.ts). Codex, added that way, is recorded in
  [ADR 0027](0027-codex-backend.md).
- **Model tiers.** Phases ask for `fast`, `balanced`, or `strong` (`config.models`), and each
  backend maps a tier to its own id (`config.agents.<id>.models`): Claude uses
  `haiku`/`sonnet`/`opus`. Cursor is two ids that share one implementation:
  `cursor-anthropic` uses `claude-haiku-5-5-medium`/`claude-sonnet-5-5-medium`/
  `claude-opus-5-5-high`; `cursor-grok` uses `grok-4.7-medium`/`grok-4.7-high`/
  `grok-4.7-xhigh`.
- **One `Agent` per run** (`createAgent(id)`) bundles the backend, its process runner, and a
  map from each session to its tier. A resume therefore knows its model: Cursor passes
  `--model` on every resume, while Claude doesn't need it. The usage summary labels each row
  with the backend's model id. The pipeline builds the agent from `PipelineOptions.agent` and
  threads it to every phase via `RunnerDeps.agent`.
- **No default agent; the choice is remembered.** Before any other work,
  `src/cli/agent-choice.ts` decides the agent:
  - `--agent <claude|cursor-anthropic|cursor-grok|codex>` wins, and is saved if it differs from the saved choice.
  - Otherwise the saved choice is used: `agent` in `~/.config/tulip/config.json`
    (`$XDG_CONFIG_HOME/tulip/config.json` if set, `%APPDATA%\tulip\config.json` on Windows;
    `src/cli/settings.ts`).
  - Otherwise, if stdin and stdout are a terminal, Tulip shows a numbered menu, re-asks on bad
    input, and saves the answer. With no terminal it fails with a message asking for `--agent`.

  A malformed settings file or unknown agent id reads as "nothing saved", so the user is asked
  again. If the save itself fails, the run continues with a warning. Phase unit tests, which call
  phases without an agent, still fall back to the Claude backend inside `invokeAgent`; the
  pipeline always passes the chosen one.
- **Cursor backends.** `cursor-anthropic` and `cursor-grok` share argv, prompt preparation,
  reply parsing, and workspace cleanup. Only the `--model` id differs.
  - Argv: `-p --output-format json --mode ask --trust --model <id> [--resume <id>]`. Never
    `--force`, `--yolo`, or `--approve-mcps`.
  - `planSpawn` appends `src/prompts/structured-output.md` (the schema, plus "reply with
    only this JSON") to every turn's prompt, including retries.
  - `parseReply` takes the JSON from the whole text, else from the last fenced block, else from
    the leftmost balanced `{...}` that parses. If none parses, `structured` is `undefined` and
    the generic retry asks again. Validation is the same local check as for Claude.
  - `prepareWorkspace` deletes `.cursor/` and `.claude/` from the checkout before any call; the
    `rm` unlinks a symlinked dir without following it (cf. the `.tulip` fix in ADR 0002). The
    pipeline calls it right after `materializeChangeArtifacts`.

## Consequences

- Cursor runs every pass with the same prompts, schemas, retry, and usage summary. The only
  prompt difference is the appended schema instruction.
- A first run needs one answer (or `--agent`), and scripted/CI use must pass `--agent` once per
  machine or pre-seed the settings file.
- Structured output under Cursor relies on the model following the prompt, not on a CLI
  constraint. A malformed reply costs one retry turn, and a second failure fails the phase, as
  for Claude.
- Files the PR adds or changes under `.cursor/` or `.claude/` can't be read from the checkout
  by a Cursor session. Their diffs are still in the prompt and in `.tulip/pr.diff`.
- `--trust` records the temp checkout as trusted in Cursor's own state. The directory is
  deleted after the run.
- Whether `claude -p` likewise runs a PR's `.claude/settings.json` hooks wasn't checked here;
  it's tracked in TODO.md. With `prepareWorkspace` in place, the fix would be a one-line
  addition to the Claude backend.
