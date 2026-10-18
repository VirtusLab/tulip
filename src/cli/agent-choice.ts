import type { AgentId } from "../agent/types.js";
import { readUserSettings, saveUserSettings } from "./settings.js";

/** Used when neither `--agent` nor a saved choice names one. */
export const DEFAULT_AGENT: AgentId = "claude";

export interface ResolveAgentOptions {
  /** Where the choice is remembered — see ./settings.ts's `userSettingsPath`. */
  settingsPath: string;
  log: (line: string) => void;
}

/**
 * Decides which agent this run uses: `--agent` wins (and is remembered if it changes the saved
 * choice); otherwise the saved choice; otherwise {@link DEFAULT_AGENT}.
 */
export async function resolveAgent(
  flag: AgentId | undefined,
  { settingsPath, log }: ResolveAgentOptions,
): Promise<AgentId> {
  const saved = (await readUserSettings(settingsPath)).agent;
  if (flag === undefined) {
    return saved ?? DEFAULT_AGENT;
  }
  if (flag !== saved) {
    await remember(flag, settingsPath, log);
  }
  return flag;
}

/** A failed save never blocks the run: it only means the flag is needed again next time. */
async function remember(
  agent: AgentId,
  settingsPath: string,
  log: (line: string) => void,
): Promise<void> {
  try {
    await saveUserSettings(settingsPath, { agent });
    log(`Saved ${agent} as the agent for future runs (in ${settingsPath}).`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`Couldn't save ${agent} as the agent for future runs to ${settingsPath}: ${reason}`);
  }
}
