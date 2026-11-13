# 29. Extra read-only context directories

## Context

Sessions can read only the PR checkout ([ADR 0002](0002-checkout-access-for-llm-sessions.md)).
Many PRs use things defined in other repositories: a shared library, a type defined elsewhere,
the caller of a changed endpoint. An explanation then guesses what such an identifier means, or
leaves it undefined, even when the user has the defining repository on disk.

## Decision

- **`--context-dir <path>`**, repeatable. Each path is resolved to an absolute directory at
  parse time; a missing path or a file is a usage error.
- **Claude only.** `claude -p` gets `--add-dir <dirs...>`, which widens Read/Grep/Glob. No Bash
  is granted, so access stays read-only as for the checkout. Backends declare
  `supportsContextDirs`; the pipeline fails before the checkout for any backend without it,
  rather than silently ignoring the flag. Codex (sandbox read dirs) and Cursor can follow.
- **The model is told.** Every fresh session's prompt carries `context-dirs.md` after the
  preamble, listing the directories and asking it to look up what the PR uses from them and
  explain it where that helps the reviewer. Resumes don't repeat it. A firmer, always-on
  instruction in the explain checklist made the model define every such identifier, but it
  also changed runs without `--context-dir`, so it was left out.

## Consequences

- Explanations can define identifiers that live outside the PR.
- A prompt-injected PR can steer the model into reading the context directories, and quote
  them in the rendered page. They are user-chosen, so this is documented in the README rather
  than prevented. Context directories' own `.claude/` config is not stripped. AFAIK `--add-dir`
  doesn't load settings or hooks from added directories, but this hasn't been verified.
