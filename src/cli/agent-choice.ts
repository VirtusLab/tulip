import { createInterface } from "node:readline";
import { AGENT_IDS, type AgentId, backendFor, isAgentId } from "../agent/backend.js";
import { CliUsageError } from "./args.js";
import { readUserSettings, saveUserSettings } from "./settings.js";

/** The terminal the agent menu talks to; injectable for tests. */
export interface AgentChoiceIo {
  /** Whether a human can answer: stdin and stdout are both TTYs. */
  interactive: boolean;
  /** Prints `question` and resolves with the typed line, or `undefined` on EOF/Ctrl+C. */
  ask(question: string): Promise<string | undefined>;
  write(line: string): void;
}

export interface ResolveAgentOptions {
  /** Where the choice is remembered — see ./settings.ts's `userSettingsPath`. */
  settingsPath: string;
  io: AgentChoiceIo;
}

/**
 * Decides which agent this run uses. There is no default: an explicit `--agent` wins (and is
 * remembered if it changes the saved choice); otherwise the saved choice; otherwise the user is
 * asked, before any other work, and the answer is saved. Throws {@link CliUsageError} if no
 * agent is known and nobody can be asked (non-interactive run) or the user gives up.
 */
export async function resolveAgent(
  flag: AgentId | undefined,
  { settingsPath, io }: ResolveAgentOptions,
): Promise<AgentId> {
  const saved = (await readUserSettings(settingsPath)).agent;

  if (flag !== undefined) {
    if (flag !== saved) {
      await remember(flag, settingsPath, io);
    }
    return flag;
  }
  if (saved !== undefined) {
    return saved;
  }

  if (!io.interactive) {
    throw new CliUsageError(
      `No agent chosen yet. Run once with --agent <${AGENT_IDS.join("|")}>; Tulip remembers it.`,
    );
  }
  const chosen = await askForAgent(io);
  await remember(chosen, settingsPath, io);
  return chosen;
}

async function askForAgent(io: AgentChoiceIo): Promise<AgentId> {
  io.write("Which agent CLI should Tulip use to analyze PRs?");
  AGENT_IDS.forEach((id, index) => {
    const backend = backendFor(id);
    io.write(`  ${index + 1}) ${id.padEnd(8)}${backend.label} (runs \`${backend.bin}\`)`);
  });
  const range = `1-${AGENT_IDS.length}`;
  for (;;) {
    const answer = await io.ask(`Enter ${range}: `);
    if (answer === undefined) {
      throw new CliUsageError(`No agent chosen. Pass --agent <${AGENT_IDS.join("|")}>.`);
    }
    const chosen = parseAnswer(answer.trim());
    if (chosen !== undefined) {
      return chosen;
    }
    io.write(`Please enter a number ${range} or an agent name (${AGENT_IDS.join(", ")}).`);
  }
}

function parseAnswer(answer: string): AgentId | undefined {
  const index = Number(answer);
  if (Number.isInteger(index) && index >= 1 && index <= AGENT_IDS.length) {
    return AGENT_IDS[index - 1];
  }
  const name = answer.toLowerCase();
  return isAgentId(name) ? name : undefined;
}

/** A failed save never blocks the run: it only means the user is asked again next time. */
async function remember(agent: AgentId, settingsPath: string, io: AgentChoiceIo): Promise<void> {
  try {
    await saveUserSettings(settingsPath, { agent });
    io.write(`Using ${agent} for this and future runs (saved in ${settingsPath}).`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    io.write(`Using ${agent}; couldn't save the choice to ${settingsPath}: ${reason}`);
  }
}

/** {@link AgentChoiceIo} over the process's own stdin/stdout. */
export function terminalAgentChoiceIo(): AgentChoiceIo {
  return {
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    write: (line) => console.log(line),
    ask: (question) =>
      new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        let answered = false;
        rl.on("close", () => {
          if (!answered) {
            process.stdout.write("\n");
            resolve(undefined);
          }
        });
        rl.on("SIGINT", () => rl.close());
        rl.question(question, (answer) => {
          answered = true;
          rl.close();
          resolve(answer);
        });
      }),
  };
}
