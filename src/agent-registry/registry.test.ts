import { describe, expect, it } from "vitest";
import { createAgentFor } from "./registry.js";

describe("createAgentFor", () => {
  it("maps Grok tiers to low, medium, and high", () => {
    const agent = createAgentFor("cursor-grok");
    expect(agent.backend.id).toBe("cursor-grok");
    expect(agent.modelFor("fast")).toBe("grok-4.7-low");
    expect(agent.modelFor("balanced")).toBe("grok-4.7-medium");
    expect(agent.modelFor("strong")).toBe("grok-4.7-high");
  });
});
