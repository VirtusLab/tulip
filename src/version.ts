import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Version info shown at startup and by `--version`: the package version plus the commit/date
 * the running build was made from. */
export interface BuildInfo {
  version: string;
  commitSha: string;
  buildDate: string;
}

// Resolved via import.meta.url (not process.cwd()) so these always point next to this module
// itself — dist/build-info.json next to the compiled dist/version.js (see
// scripts/gen-build-info.mjs), and the repo-root package.json one level up either way, since
// src/version.ts sits directly under src/ just as dist/version.js sits directly under dist/.
const BUILD_INFO_PATH = fileURLToPath(new URL("./build-info.json", import.meta.url));
const PACKAGE_JSON_PATH = fileURLToPath(new URL("../package.json", import.meta.url));

/**
 * Reads the build-time version snapshot. Falls back to package.json's version (with a "dev"
 * commit sha and "unknown" build date) when dist/build-info.json is missing — running from
 * source before a build, or an install stripped of it — so startup never fails or blocks on
 * missing version info.
 */
export function getBuildInfo(): BuildInfo {
  try {
    return JSON.parse(readFileSync(BUILD_INFO_PATH, "utf8")) as BuildInfo;
  } catch {
    return { version: readPackageVersion(), commitSha: "dev", buildDate: "unknown" };
  }
}

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Formats {@link BuildInfo} as a single display line, e.g.
 * "Tulip 0.1.0 (a1b2c3d, built 2026-08-27T10:00:00.000Z)", or "Tulip 0.1.0 (dev)" for the
 * no-build-info fallback. Used for both the startup welcome message and `--version`. */
export function formatVersion(info: BuildInfo = getBuildInfo()): string {
  if (info.commitSha === "dev") {
    return `Tulip ${info.version} (dev)`;
  }
  return `Tulip ${info.version} (${info.commitSha}, built ${info.buildDate})`;
}
