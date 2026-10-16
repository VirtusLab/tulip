import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type AgentId, isAgentId } from "../agent/backend.js";
import { isPlainObject } from "../agent/schema.js";

/** Choices tulip remembers between runs. */
export interface UserSettings {
  agent?: AgentId;
}

/**
 * Where {@link UserSettings} live: `$XDG_CONFIG_HOME/tulip/config.json`, falling back to
 * `~/.config/tulip/config.json`; `%APPDATA%\tulip\config.json` on Windows.
 */
export function userSettingsPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const base =
    platform === "win32"
      ? env.APPDATA || join(home, "AppData", "Roaming")
      : env.XDG_CONFIG_HOME || join(home, ".config");
  return join(base, "tulip", "config.json");
}

/** The saved settings; a missing, unreadable, or malformed file — or an unknown agent id —
 * reads as "nothing saved", so the user is simply asked again. */
export async function readUserSettings(path: string): Promise<UserSettings> {
  const { agent } = await readSettingsObject(path);
  return typeof agent === "string" && isAgentId(agent) ? { agent } : {};
}

/** Merges `settings` into the saved file, creating its directory if needed. */
export async function saveUserSettings(path: string, settings: UserSettings): Promise<void> {
  const existing = await readSettingsObject(path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ ...existing, ...settings }, null, 2)}\n`);
}

/** The file's top-level JSON object; `{}` if it's missing, unreadable, or not an object. */
async function readSettingsObject(path: string): Promise<Record<string, unknown>> {
  try {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    return isPlainObject(raw) ? raw : {};
  } catch {
    return {};
  }
}
