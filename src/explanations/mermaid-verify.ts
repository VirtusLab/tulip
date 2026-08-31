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
  // Character offset to resume the *next* search from — not an array index into
  // findMermaidFences' result. A degraded fence is replaced by plain text (no fence markers at
  // all), so the fence count shrinks by one; an index-based "cursor" would then skip whichever
  // fence slid into the vacated slot, shipping it as a raw, unvalidated (possibly still invalid)
  // fence — exactly the "Syntax error" box this whole feature exists to prevent. Resuming by
  // offset is immune to a replacement changing length in either direction (shrink on degrade,
  // grow or shrink on a fix), since fences are re-found fresh from `currentMarkdown` every
  // iteration and matched by position, not by list index.
  let searchFrom = 0;

  while (true) {
    const fences = findMermaidFences(currentMarkdown);
    const fence = fences.find((candidate) => candidate.start >= searchFrom);
    if (!fence) {
      break;
    }

    const validation = await validateMermaidDiagram(fence.source);
    if (validation.valid) {
      searchFrom = fence.end;
      continue;
    }

    logger.debug(
      `category "${categoryName}": a mermaid diagram failed to validate: ${validation.error}`,
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
    // Resume right after whatever was just written, whatever its length — never the original
    // fence's (possibly now-wrong) end offset.
    searchFrom = fence.start + fixed.replacement.length;
  }

  return { markdown: currentMarkdown, sessionId: currentSessionId };
}

/** Resumes the explaining session up to {@link MAX_MERMAID_FIX_ATTEMPTS} times to fix one
 * invalid diagram. Returns the fenced, corrected diagram on success, or the degradation note if
 * every attempt is still invalid (including one that's syntactically valid mermaid but doesn't
 * round-trip through fence-wrapping — see {@link roundTripsThroughFence} — since that would ship
 * something other than what was validated). */
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
    const candidate = response.result.source;

    if (!roundTripsThroughFence(candidate)) {
      // A ``` line inside `candidate` would be read back as the fence's *closing* delimiter
      // (see ../rendering/mermaid.ts's fence pattern), so what actually renders would be a
      // truncated prefix of what was just validated — never accept this, no matter how the
      // parser feels about `candidate` on its own.
      source = candidate;
      error =
        "the corrected source must not contain a line that is just ``` — that breaks how the " +
        "diagram is embedded in the page (it would be read as the fence's closing delimiter, " +
        "truncating everything after it)";
      continue;
    }

    const validation = await validateMermaidDiagram(candidate);
    if (validation.valid) {
      return { replacement: renderMermaidFence(candidate), sessionId: currentSessionId };
    }
    source = candidate;
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

/** True only if wrapping `source` in a mermaid fence and reading it back with the exact same
 * fence parser the renderer uses (`findMermaidFences`) yields `source` unchanged — i.e. splicing
 * `renderMermaidFence(source)` into the markdown is guaranteed to validate and render the same
 * text. Guards against a fix response that itself contains a ``` line, which would otherwise be
 * mistaken for the fence's closing delimiter on the next parse. */
function roundTripsThroughFence(source: string): boolean {
  return findMermaidFences(renderMermaidFence(source))[0]?.source === source;
}

function spliceFence(markdown: string, fence: MermaidFenceMatch, replacement: string): string {
  return markdown.slice(0, fence.start) + replacement + markdown.slice(fence.end);
}
