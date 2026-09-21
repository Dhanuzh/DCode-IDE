import type { AgentLauncherId } from "./launcher";

/**
 * Agents the built-in AI can drive end to end: they report "finished" through
 * installed hooks, which is what triggers the supervisor's review turn.
 */
export const MANAGED_AGENT_IDS = [
  "claude",
  "codex",
  "gemini",
  "pi",
] as const satisfies readonly AgentLauncherId[];

export type ManagedAgentId = (typeof MANAGED_AGENT_IDS)[number];

export function isManagedAgentId(value: string): value is ManagedAgentId {
  return (MANAGED_AGENT_IDS as readonly string[]).includes(value);
}

// Text each TUI shows once its input box accepts a prompt. Agents without a
// stable marker fall back to "output changed, then went quiet".
const READY_MARKERS: Record<ManagedAgentId, string[]> = {
  claude: ["? for shortcuts", "shortcuts"],
  codex: ["for shortcuts"],
  gemini: ["Type your message"],
  pi: [],
};

export const READY_QUIET_MS = 2500;

/**
 * `marker`: the agent's own input prompt is on screen. `quiet`: output changed
 * and then settled. Either way callers must confirm a foreground process owns
 * the terminal before typing into it: after a failed launch the text on screen
 * is the shell's, and a submitted prompt would run as a command.
 */
export type Readiness = "marker" | "quiet" | null;

export type ReadinessTracker = {
  observe: (buffer: string, now: number) => Readiness;
};

export function createReadinessTracker(
  agent: ManagedAgentId,
  initialBuffer: string,
  quietMs = READY_QUIET_MS,
): ReadinessTracker {
  const markers = READY_MARKERS[agent];
  let last = initialBuffer;
  let changedAt: number | null = null;
  return {
    observe(buffer, now) {
      const fresh = buffer.slice(Math.max(0, buffer.length - 4000));
      if (markers.some((m) => fresh.includes(m)) && buffer !== initialBuffer) {
        return "marker";
      }
      if (buffer !== last) {
        last = buffer;
        changedAt = now;
        return null;
      }
      return changedAt !== null && now - changedAt >= quietMs ? "quiet" : null;
    },
  };
}
