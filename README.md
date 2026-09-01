# Tulip

Tulip turns a GitHub pull request into a review-friendly web page. Instead of a
flat list of file diffs, it groups the changes by what they do, ranks each group
by how closely you should read it, and explains each one in plain prose — with
diagrams and inline code — as a single self-contained HTML page you open in a
browser.

It drives the `claude` CLI to do the analysis, so no API key is needed beyond a
logged-in Claude Code.

## How it works

Tulip fetches the PR and runs it through a few LLM passes, each using a model
sized to the job:

1. **Fetch & check out.** Get the PR (title, description, diff) via `gh` (or the
   GitHub API), check out its head revision, and write the full diff plus the
   before-versions of changed files into the checkout, so later passes can read
   the real code.
2. **Categorize** (Sonnet). Split the changes into a few self-contained groups by
   concern — tests and docs ride along with the code they belong to. Each group
   gets an *attention* rating (Read closely / Read through / Skim); groups are
   ordered most-important first.
3. **Classify** (Haiku). Assign every change to one of those groups and mark it as
   production or test code. Unfitting changes can propose a new group; generated
   files and lockfiles are dropped. Every change is checked to be covered.
4. **Explain** (Opus, one session per group). Write a prose explanation grounded in
   the actual code — interleaving diagrams (Mermaid) and references to specific
   line ranges. A separate pass (Sonnet) reviews each explanation for clarity and
   correctness, every referenced snippet is checked to appear, and every diagram is
   validated to actually render.
5. **Render.** Assemble everything into one self-contained HTML page: light/dark
   theme, floating table of contents, syntax-highlighted side-by-side diffs, and
   the attention badges.

The result is a temporary directory with the page; Tulip logs the `file://` path
to open.

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

Flags: `--diff-threshold <n>`, `--verbose`. Run `tulip --help` for details, or
`tulip --version` for the build.

On success, Tulip logs a `file://...` path to the generated HTML page — open it
in a browser.

## Development

```sh
pnpm build        # compile TypeScript + copy rendering assets
pnpm test         # run the test suite (vitest)
pnpm lint         # check formatting/lint rules (biome)
pnpm lint:fix     # auto-fix formatting/lint issues
pnpm dev <PR URL> # run the CLI from source, no build step (tsx)
```

Design decisions are recorded as ADRs in `docs/adr/`; the LLM prompts live as
plain text in `src/prompts/`.
