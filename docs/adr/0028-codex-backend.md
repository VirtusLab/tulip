# 28. Codex CLI backend

## Context

[ADR 0027](0027-pluggable-agent-backends.md) split the agent CLIs behind `AgentBackend` so a
third CLI is another backend, a config entry, and an id in `AGENT_IDS`. Codex (`codex exec`)
differs from both Claude and Cursor in ways that matter here. These were taken from Codex's
non-interactive docs and the `codex exec` reference; the CLI was not run locally.

Later checks against a live `codex` 0.161 (see "Amendment: live fixes" below) corrected several
of these.

- **Output.** `--json` is a JSONL event stream, not one object with `result` and `session_id`.
  The session id is `thread.started`'s `thread_id`. The reply text is the last
  `item.completed` `agent_message`. Token counts are on `turn.completed` (`input_tokens`,
  `output_tokens`, `cache_write_input_tokens`, `cached_input_tokens`). A failed turn is
  `turn.failed` or `error`.
- **Structured output.** `--output-schema` takes a file path, not the schema itself.
  Intermediate agent messages can be forced into that schema too, so only the last agent
  message is the reply.
- **Prompt delivery.** A prompt string beside a pipe makes stdin extra context. `codex exec -`
  makes stdin the prompt.
- **Tools.** `codex exec` defaults to a read-only sandbox, but user config can widen it, and
  CLI flags win over config. A command that needs approval would otherwise wait until Tulip's
  process timeout. Project `.codex/` (config, hooks, MCP) loads only once the project is
  trusted; a temp checkout must not be able to supply it.

## Decision

- **Backend** `src/agent/backends/codex.ts`, id `codex`, binary `codex`. Model tiers in
  `config.agents.codex.models` are chosen for ChatGPT sign-in, where `gpt-5.4` and `gpt-5.5`
  are retired. `gpt-6-astra` is stronger but not on every plan, so no tier uses it.
- **Argv.** Superseded; see the amendment. `exec --json --sandbox read-only
  --ask-for-approval never --model <id> --output-schema <file> [resume <thread_id>] -`. `--model` is passed on resume too, as for
  Cursor. Never `--yolo`, `danger-full-access`, `workspace-write`, `--approve-for-me`, or
  `--dangerously-bypass-hook-trust`. No `--skip-git-repo-check`: the checkout is a git repo.
- **Schema file.** Every backend implements `planSpawn`, which returns `{ args, prompt, files }`.
  Claude and Cursor return no files. Codex returns one JSON file under `os.tmpdir()`, unique
  per call, outside the checkout, because `--output-schema` takes a path. The runner writes
  each file before the process and deletes it afterwards, including when the process fails.
  The prompt is not rewritten. Tulip still validates the parsed JSON locally and retries once.
- **Parsing.** `parseReply` walks the JSONL. The session id is the last `thread_id`. The text
  is the last completed `agent_message`, parsed with the shared `extractJson`. Usage comes
  from the last `turn.completed` (made a per-call delta by the amendment);
  `reasoning_output_tokens` is not added on top of `output_tokens`. A missing `thread_id`, a
  non-JSON line, `turn.failed`, or `error` throws `AgentOutputError` (`error` no longer does; see
  the amendment).
- **Workspace.** `repoConfigDirs` is `.codex`, so `.codex/` is deleted from the checkout (`rm`
  unlinks a symlink without following it). `AGENTS.md` stays.

## Consequences

- Codex runs every pass with the same prompts, schemas, retry, and usage summary. The schema
  reaches the CLI as a file rather than as prompt text.
- A reply with no parseable JSON in the last agent message costs one retry turn, then fails
  the phase, as for the other backends.
- Files the PR adds or changes under `.codex/` can't be read from the checkout. Their diffs
  are still in the prompt and in `.tulip/pr.diff`.
- The model ids are the documented ChatGPT-sign-in slugs. They were not checked against a
  live `codex` binary.

## Amendment: live fixes

### Context

A review running `codex` 0.161 found that the backend as first written failed every call, and
that its sandbox did not hold:

- `--ask-for-approval` is a top-level option, not an `exec` one: `exec` exits 2.
- `--output-schema` is sent in OpenAI strict mode: every object needs
  `additionalProperties: false` and every property in `required`. Tulip's schemas have neither,
  so every turn failed (`invalid_json_schema`).
- On failure Codex exits 1 with an empty stderr; the error is only in stdout's `error` /
  `turn.failed` events. Tulip showed just "`codex` exited with code 1".
- `--sandbox read-only` limits writes only. The model's shell could read the whole disk
  (`~/.config/gh/hosts.yml`, `~/.codex/auth.json`, `~/.ssh`) and the inherited environment
  (`GITHUB_TOKEN`). That contradicts ADR 0002: a malicious PR could have the model put a secret
  in the page, e.g. in a remote image URL fetched on page open.
- Web search and ChatGPT apps run server-side, outside the local sandbox. The model opened an
  arbitrary URL with no approval.
- `turn.completed.usage` is the thread's running total, so every resume re-counted earlier
  turns. `input_tokens` includes `cached_input_tokens`.

### Decision

- **Argv.** `--ask-for-approval never -c default_permissions="tulip"
  -c permissions.tulip.filesystem={...} -c shell_environment_policy.inherit="core"
  -c web_search="disabled" --disable apps --disable plugins exec --json --ignore-user-config
  --model <id> --output-schema <file> [resume <thread_id>] -`. No `--sandbox`: Codex rejects it
  together with `default_permissions`.
- **Read confinement.** Codex's shell is its only way to read files, so it is confined rather than
  disabled. The `tulip` permission profile reads `:minimal` (what a shell needs), the checkout
  (`:workspace_roots`), and Codex's own binary dir, and nothing else; it has no network and no
  write access. On Linux, Codex re-runs its own binary inside bubblewrap, so without that dir
  every command fails with "bwrap: execvp ...", and Codex still exits 0. Tulip asks Codex for
  the binary once per process (`codex doctor --json`, "current executable"), which sees through
  npm's `codex.js`, mise/volta shims, and wrapper scripts, unlike a `PATH` lookup. The
  `codex-path` (`rg`) and `codex-resources` (fallback `bwrap`) dirs next to it are readable too.
  If a command still fails that way, `parseReply` throws rather than let the model explain the
  PR without reading the checkout. Verified live: the shell reads the checkout, `~` is empty,
  `~/.config/gh/hosts.yml` is not there, writes fail, and the same holds on `resume`.
- **Environment.** `shell_environment_policy.inherit="core"` gives commands only core vars
  (verified: no `*TOKEN*`/`*SECRET*` var reaches them). Independently, every backend's process
  is spawned without `GITHUB_TOKEN`, `GH_TOKEN`, and `GITLAB_TOKEN` (src/agent/exec.ts): no
  agent CLI needs them.
- **Server-side tools.** Web search, apps, and plugins are off. `--ignore-user-config` drops the
  user's `config.toml`: MCP servers, feature flags, and profiles. Login still works (auth is in
  `CODEX_HOME`), but a custom model provider set there is ignored.
- **Strict schema.** `planSpawn` writes a strict copy of the schema (src/agent/backends/
  codex-schema.ts): every object gets `additionalProperties: false` and requires all its
  properties; an optional one becomes `anyOf: [<schema>, {type: "null"}]`. `parseReply` (which
  now receives the call's schema) drops those `null`s before the usual local validation against
  the original schema.
- **Failures.** Only `turn.failed` fails a call: a top-level `error` can be a transient notice
  ("Reconnecting... 2/5") in a turn that then completes. `AgentBackend.describeFailure` reads a
  failed call's stdout and, when it finds a message, is shown instead of stderr. Codex's returns
  the last `error`/`turn.failed` message, unwrapped from the API's JSON body; Claude's returns
  the envelope's `result` (or `subtype`). Otherwise stderr is shown, else stdout's tail.
- **Usage.** `AgentBackend.usageIsSessionTotal` makes the runner record the difference from the
  session's previous total, kept per run on `Agent.sessionUsage`. Uncached input is
  `input_tokens - cached_input_tokens`. `output_tokens` already includes
  `reasoning_output_tokens`.
- **Page.** The rendered page has a deny-by-default CSP (src/rendering/template.ts): only its own
  scripts, styles, and fonts, `data:` images, and same-origin `fetch` (for `--serve`). Otherwise
  model-written markdown or mermaid labels (`<img>`, `<video>`, `<audio>` survive mermaid's
  sanitizer) could make the page fetch a URL on open. This applies to every backend.

### Consequences

- Codex sessions read the checkout as before, but nothing else on disk or in the environment.
- Each run spawns `codex doctor --json` once (under a second, offline). If it can't name the
  binary, the first Codex call fails with that error.
- The read confinement was verified on Linux only. macOS uses Seatbelt, which doesn't re-run the
  binary, but the profile there was not run.
- Images in the PR description no longer show on the page.
