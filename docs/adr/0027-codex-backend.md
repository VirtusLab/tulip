# 27. Codex CLI backend

## Context

[ADR 0026](0026-pluggable-agent-backends.md) split the agent CLIs behind `AgentBackend` so a
third CLI is another backend, a config entry, and an id in `AGENT_IDS`. Codex (`codex exec`)
differs from both Claude and Cursor in ways that matter here. These were taken from Codex's
non-interactive docs and the `codex exec` reference; the CLI was not run locally.

- **Output.** `--json` is a JSONL event stream, not one object with `result` and `session_id`.
  The session id is `thread.started`'s `thread_id`. The reply text is the last
  `item.completed` `agent_message`. Token counts are on `turn.completed` (`input_tokens`,
  `output_tokens`, `cache_write_input_tokens`, `cached_input_tokens`). A failed turn is
  `turn.failed` or `error`.
- **Structured output.** `--output-schema` takes a file path. The schema must not go in argv
  (same size reason prompts stay on stdin). Intermediate agent messages can be forced into
  that schema too, so only the last agent message is the reply.
- **Prompt delivery.** A prompt string beside a pipe makes stdin extra context. `codex exec -`
  makes stdin the prompt.
- **Tools.** `codex exec` defaults to a read-only sandbox, but user config can widen it, and
  CLI flags win over config. A command that needs approval would otherwise wait until Tulip's
  process timeout. Project `.codex/` (config, hooks, MCP) loads only once the project is
  trusted; a temp checkout must not be able to supply it.

## Decision

- **Backend** `src/agent/backends/codex.ts`, id `codex`, binary `codex`. Model tiers in
  `config.agents.codex.models`, for ChatGPT sign-in (`gpt-5.4` and `gpt-5.5` are retired on
  that path): fast `gpt-6-luna`, balanced `gpt-6-sol`, strong `gpt-6.1-sol`. `gpt-6-astra` is
  stronger but not on every plan, so it is not the default.
- **Argv.** `exec --json --sandbox read-only --ask-for-approval never --model <id>
  --output-schema <file> [resume <thread_id>] -`. `--model` is passed on resume too, as for
  Cursor. Never `--yolo`, `danger-full-access`, `workspace-write`, `--approve-for-me`, or
  `--dangerously-bypass-hook-trust`. No `--skip-git-repo-check`: the checkout is a git repo.
- **Schema file.** Every backend implements `planSpawn`, which returns `{ args, prompt, files }`.
  Claude and Cursor return no files. Codex returns one JSON file under `os.tmpdir()`, unique
  per call, outside the checkout, because `--output-schema` takes a path. The runner writes
  each file before the process and deletes it afterwards, including when the process fails.
  The prompt is not rewritten. Tulip still validates the parsed JSON locally and retries once.
- **Parsing.** `parseReply` walks the JSONL. The session id is the last `thread_id`. The text
  is the last completed `agent_message`, parsed with the shared `extractJson`. Usage comes
  from the last `turn.completed`; `reasoning_output_tokens` is not added on top of
  `output_tokens`. A missing `thread_id`, a non-JSON line, `turn.failed`, or `error` throws
  `AgentOutputError`.
- **Workspace.** `prepareWorkspace` deletes `.codex/` from the checkout (`rm` unlinks a
  symlink without following it). `AGENTS.md` stays.

## Consequences

- Codex runs every pass with the same prompts, schemas, retry, and usage summary. The schema
  reaches the CLI as a file rather than as prompt text.
- A reply with no parseable JSON in the last agent message costs one retry turn, then fails
  the phase, as for the other backends.
- Files the PR adds or changes under `.codex/` can't be read from the checkout. Their diffs
  are still in the prompt and in `.tulip/pr.diff`.
- The model ids are the documented ChatGPT-sign-in slugs. They were not checked against a
  live `codex` binary.
