import type { RunnerDeps } from "../claude/runner.js";
import { resumeSession } from "../claude/session.js";
import { config } from "../config.js";
import { createLogger, type Logger } from "../logging/logger.js";
import { findMermaidFences, type MermaidFenceMatch } from "../rendering/mermaid.js";
import { validateMermaidDiagram } from "../rendering/mermaid-validate.js";
import { buildMermaidFixPrompt } from "./prompt.js";
import { MERMAID_FIX_SCHEMA, type MermaidFixResponse } from "./wire.js";

/** Fix attempts per invalid diagram before giving up (docs/adr/0008; spec: "keep it a small,
 * targeted fix" — mirrors ./coverage.ts's own attempt cap). */
const MAX_MERMAID_FIX_ATTEMPTS = config.limits.maxMermaidFixAttempts;

/** Shown in place of a diagram that's still invalid after every fix attempt — never leaves a
 * fence the browser would render as its own "Syntax error" box (docs/adr/0008). */
const DEGRADED_DIAGRAM_NOTE = "> _(A diagram was omitted here because it failed to render.)_";

export interface MermaidVerifyDeps extends RunnerDeps {
  /** Defaults to a fresh non-verbose logger. Used to log validation/fix/degradation progress. */
  logger?: Logger;
}

/**
 * Task 6.6/docs/adr/0008: validates every ```mermaid fence in `markdown` with the same parser
 * the browser will use (see ../rendering/mermaid-validate.ts), so a diagram that renders as a
 * "Syntax error" box in the client is caught before the page ships. An invalid diagram is fixed
 * by resuming the explaining session with its exact source and mermaid's own error, asking for
 * just the corrected source — up to {@link MAX_MERMAID_FIX_ATTEMPTS} times. One still invalid
 * after that is replaced with a plain note (never left as a fence that would render broken), and
 * a warning is logged naming the category. Valid diagrams are left untouched — no LLM call.
 */
export async function verifyMermaidDiagrams(
  markdown: string,
  sessionId: string,
  categoryName: string,
  deps: MermaidVerifyDeps = {},
): Promise<{ markdown: string; sessionId: string }> {
  const logger = deps.logger ?? createLogger();

  let currentMarkdown = markdown;
  let currentSessionId = sessionId;
  let cursor = 0;

  // Fences are re-found after every fix (rather than tracking offsets manually) so a
  // replacement's different length can never desync a stale position — cheap, since a category's
  // explanation has only a handful of diagrams. `cursor` tracks how many leading fences (in
  // document order) are already known-valid or resolved, so a re-find always resumes at the
  // right one.
  while (true) {
    const fences = findMermaidFences(currentMarkdown);
    if (cursor >= fences.length) {
      break;
    }
    const fence = fences[cursor] as MermaidFenceMatch;

    const validation = await validateMermaidDiagram(fence.source);
    if (validation.valid) {
      cursor++;
      continue;
    }

    logger.debug(
      `category "${categoryName}": mermaid diagram ${cursor + 1} failed to validate: ${validation.error}`,
    );
    const fixed = await fixMermaidFence(
      fence,
      validation.error ?? "unknown parse error",
      currentSessionId,
      categoryName,
      logger,
      deps,
    );
    currentMarkdown = spliceFence(currentMarkdown, fence, fixed.replacement);
    currentSessionId = fixed.sessionId;
    cursor++;
  }

  return { markdown: currentMarkdown, sessionId: currentSessionId };
}

/** Resumes the explaining session up to {@link MAX_MERMAID_FIX_ATTEMPTS} times to fix one
 * invalid diagram. Returns the fenced, corrected diagram on success, or the degradation note if
 * every attempt is still invalid. */
async function fixMermaidFence(
  fence: MermaidFenceMatch,
  initialError: string,
  sessionId: string,
  categoryName: string,
  logger: Logger,
  deps: MermaidVerifyDeps,
): Promise<{ replacement: string; sessionId: string }> {
  let source = fence.source;
  let error = initialError;
  let currentSessionId = sessionId;

  for (let attempt = 1; attempt <= MAX_MERMAID_FIX_ATTEMPTS; attempt++) {
    logger.info(
      `category "${categoryName}": fixing invalid mermaid diagram ` +
        `(attempt ${attempt}/${MAX_MERMAID_FIX_ATTEMPTS})`,
    );

    const response = await resumeSession<MermaidFixResponse>(
      {
        sessionId: currentSessionId,
        schema: MERMAID_FIX_SCHEMA,
        prompt: buildMermaidFixPrompt(source, error),
      },
      deps,
    );
    currentSessionId = response.sessionId;

    const validation = await validateMermaidDiagram(response.result.source);
    if (validation.valid) {
      return {
        replacement: renderMermaidFence(response.result.source),
        sessionId: currentSessionId,
      };
    }
    source = response.result.source;
    error = validation.error ?? "unknown parse error";
  }

  logger.info(
    `warning: category "${categoryName}": a mermaid diagram was still invalid after ` +
      `${MAX_MERMAID_FIX_ATTEMPTS} fix attempt(s); omitting it: ${error}`,
  );
  return { replacement: DEGRADED_DIAGRAM_NOTE, sessionId: currentSessionId };
}

function renderMermaidFence(source: string): string {
  return `\`\`\`mermaid\n${source}\n\`\`\``;
}

function spliceFence(markdown: string, fence: MermaidFenceMatch, replacement: string): string {
  return markdown.slice(0, fence.start) + replacement + markdown.slice(fence.end);
}
