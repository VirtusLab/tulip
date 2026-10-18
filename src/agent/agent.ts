import { config } from "../config.js";
import { createAgentProcessRunner } from "./exec.js";
import type { Agent, AgentBackend } from "./types.js";

/** A fresh {@link Agent} for `backend`; create one per run and thread it via `RunnerDeps.agent`. */
export function createAgent(backend: AgentBackend): Agent {
  const { bin, models } = config.agents[backend.id];
  return {
    backend,
    modelFor: (tier) => models[tier],
    runProcess: createAgentProcessRunner(bin, {
      installHint: backend.installHint,
      ...(backend.describeFailure === undefined
        ? {}
        : { describeFailure: backend.describeFailure }),
    }),
    sessionTiers: new Map(),
    sessionUsage: new Map(),
  };
}
