import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Prompt prose lives in `.md` files next to this module (docs/adr/0006) so it can be read and
 * adjusted without touching TypeScript. Resolved via `import.meta.url` rather than a relative
 * `process.cwd()` path so it's the stable directory this module itself lives in, both when
 * running from source (tsx/vitest) and from the compiled `dist/prompts/loader.js` (see
 * scripts/copy-assets.mjs, which copies the `.md` files alongside it at build time).
 */
const PROMPTS_DIR = fileURLToPath(new URL(".", import.meta.url));

const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

interface Template {
  raw: string;
  placeholders: ReadonlySet<string>;
}

/** Parsed template cache, keyed by prompt name — each `.md` file is read from disk once. */
const cache = new Map<string, Template>();

function loadTemplate(name: string): Template {
  const cached = cache.get(name);
  if (cached) {
    return cached;
  }

  // A single trailing newline (the POSIX file-ending convention, which editors add on save) is
  // stripped so a template's rendered output matches its source text exactly, with no implicit
  // trailing blank line — the same content whether or not the file on disk ends with one.
  const fileContents = readFileSync(`${PROMPTS_DIR}${name}.md`, "utf8");
  const raw = fileContents.endsWith("\n") ? fileContents.slice(0, -1) : fileContents;

  const placeholders = new Set<string>();
  for (const match of raw.matchAll(PLACEHOLDER_PATTERN)) {
    const key = match[1];
    if (key !== undefined) {
      placeholders.add(key);
    }
  }

  const template: Template = { raw, placeholders };
  cache.set(name, template);
  return template;
}

/**
 * Renders the prompt template at `src/prompts/<name>.md`, substituting every `{{placeholder}}`
 * with `vars[placeholder]`. Strict both ways — throws if the template references a placeholder
 * missing from `vars`, or if `vars` supplies a key the template doesn't reference — so a prompt
 * and its caller can't silently drift apart now that the coupling isn't enforced by the type
 * checker (see docs/adr/0006; the placeholder-coverage test exercises this for every template).
 *
 * No conditionals or includes: a template is flat text plus placeholders. Which prompt to
 * render, how to format a change/category list, and any conditional assembly (e.g. picking
 * between two partials) stay in the calling TS code, which passes the results in as `vars`.
 */
export function renderPrompt(name: string, vars: Record<string, string>): string {
  const { raw, placeholders } = loadTemplate(name);

  const missing = [...placeholders].filter((key) => !(key in vars));
  if (missing.length > 0) {
    throw new Error(
      `prompt "${name}": missing value(s) for placeholder(s): ${missing.sort().join(", ")}`,
    );
  }

  const unused = Object.keys(vars).filter((key) => !placeholders.has(key));
  if (unused.length > 0) {
    throw new Error(
      `prompt "${name}": var(s) supplied but not used by the template: ${unused.sort().join(", ")}`,
    );
  }

  return raw.replace(PLACEHOLDER_PATTERN, (_match, key: string) => vars[key] ?? "");
}

/** The `{{placeholder}}` names `src/prompts/<name>.md` declares — used by the
 * placeholder-coverage test to check every prompt-building call site supplies exactly this
 * set, since the loader itself can only check one call at a time. */
export function templatePlaceholders(name: string): ReadonlySet<string> {
  return loadTemplate(name).placeholders;
}
