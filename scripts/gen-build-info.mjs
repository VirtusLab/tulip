// Captures what only a real build (with git + a real clock available) can know, so the shipped
// dist/ never needs to shell out to git at runtime (a global install runs from a copied dist/
// with no `.git` around — see src/version.ts, which reads this file's output).
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** Short commit sha of HEAD at build time, or "unknown" if git isn't available (e.g. building
 * from a tarball with no .git directory). */
function commitSha() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

/** Writes dist/build-info.json: the package version plus the commit/date this build was made
 * from. Read at runtime by src/version.ts (compiled to dist/version.js, right next to it). */
export async function genBuildInfo() {
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));

  const buildInfo = {
    version: pkg.version,
    commitSha: commitSha(),
    buildDate: new Date().toISOString(),
  };

  const destPath = fileURLToPath(new URL("../dist/build-info.json", import.meta.url));
  await writeFile(destPath, `${JSON.stringify(buildInfo, null, 2)}\n`);
}
