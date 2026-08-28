/**
 * Maps a file path's extension to a highlight.js language name (see ./assets/vendor —
 * scripts/hljs-entry.mjs registers exactly this set), so the client can apply the right
 * `language-<name>` class before calling `hljs.highlightElement` (see ./assets/app.js).
 * Extensions not listed here — and paths with no extension other than the two special-cased
 * filenames — fall back to no highlighting rather than guessing.
 */
const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  scala: "scala",
  sc: "scala",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  html: "xml",
  htm: "xml",
  xml: "xml",
  vue: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  proto: "protobuf",
  lua: "lua",
  r: "r",
  pl: "perl",
  pm: "perl",
  ex: "elixir",
  exs: "elixir",
};

/** Filenames (matched case-insensitively, no extension) that map to a language directly. */
const FILENAME_LANGUAGE: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
};

/** Guesses a highlight.js language name from `path`'s filename, or `undefined` for an unknown
 * or absent extension — the caller (./snippets.ts) then skips highlighting rather than
 * guessing. */
export function languageForPath(path: string): string | undefined {
  const filename = (path.split("/").pop() ?? path).toLowerCase();
  const byFilename = FILENAME_LANGUAGE[filename];
  if (byFilename) {
    return byFilename;
  }

  const dot = filename.lastIndexOf(".");
  if (dot <= 0) {
    return undefined;
  }
  return EXTENSION_LANGUAGE[filename.slice(dot + 1)];
}
