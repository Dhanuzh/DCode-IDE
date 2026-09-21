import { describe, expect, it } from "vitest";
import { createReadinessTracker, isManagedAgentId } from "./agentReadiness";

describe("createReadinessTracker", () => {
  it("is ready as soon as the agent's marker appears", () => {
    const t = createReadinessTracker("claude", "$ claude");
    expect(t.observe("$ claude", 0)).toBeNull();
    expect(t.observe("$ claude\n> \n? for shortcuts", 100)).toBe("marker");
  });

  it("ignores a marker that was already on screen before launch", () => {
    const t = createReadinessTracker("gemini", "Type your message", 500);
    expect(t.observe("Type your message", 0)).toBeNull();
  });

  it("falls back to output going quiet after it changed", () => {
    const t = createReadinessTracker("pi", "$ pi", 500);
    expect(t.observe("$ pi", 0)).toBeNull();
    expect(t.observe("$ pi\nloading", 100)).toBeNull();
    expect(t.observe("$ pi\npi ready >", 200)).toBeNull();
    expect(t.observe("$ pi\npi ready >", 600)).toBeNull();
    expect(t.observe("$ pi\npi ready >", 700)).toBe("quiet");
  });

  it("never reports ready while nothing was drawn", () => {
    const t = createReadinessTracker("pi", "$ pi", 500);
    expect(t.observe("$ pi", 10_000)).toBeNull();
  });
});

describe("isManagedAgentId", () => {
  it("accepts only hook-capable agents", () => {
    expect(isManagedAgentId("codex")).toBe(true);
    expect(isManagedAgentId("opencode")).toBe(false);
    expect(isManagedAgentId("rm")).toBe(false);
  });
});
