# Tulip

Explains a GitHub PR to a reviewer: groups the changes into cohesive
categories, then generates a prose explanation per category — with diagrams
and code snippets — as a single self-contained HTML page.

## Prerequisites

- [Node.js](https://nodejs.org/) LTS (>= 24) and [pnpm](https://pnpm.io/)
- A logged-in [`claude`](https://claude.com/product/claude-code) CLI on `PATH` —
  Tulip drives it to analyze the PR
- Optionally, the [`gh`](https://cli.github.com/) CLI, logged in — used to fetch
  PR data when available; Tulip falls back to the GitHub REST API otherwise
  (set `GITHUB_TOKEN` to raise the unauthenticated rate limit)

## Install

```sh
pnpm install
pnpm build
pnpm add -g .
```

## Usage

```sh
tulip <PR URL> [options]
```

Example:

```sh
tulip https://github.com/owner/repo/pull/123
```

Flags: `--diff-threshold <n>`, `--verbose`. Run `tulip --help` for details.

On success, Tulip logs a `file://...` path to the generated HTML page — open
it in a browser.

## Development

```sh
pnpm build        # compile TypeScript + copy rendering assets
pnpm test         # run the test suite (vitest)
pnpm lint         # check formatting/lint rules (biome)
pnpm lint:fix     # auto-fix formatting/lint issues
pnpm dev <PR URL> # run the CLI from source, no build step (tsx)
```
