import type { UIMessage } from "@ai-sdk/react";
import type { SessionMeta } from "./sessions";

/** Longest string a saved tool part keeps; the live chat is never trimmed. */
export const MAX_SAVED_TOOL_STRING = 32 * 1024;

/** Sessions kept on disk; the oldest by last activity are dropped past this. */
export const MAX_SAVED_SESSIONS = 200;

// Only settled tool calls are trimmed. A call still awaiting approval must
// keep its exact input: approving it after a reload would otherwise run the
// tool (e.g. write_file) with truncated arguments.
const SETTLED_TOOL_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
]);

function truncateString(value: string, max: number): string {
  if (value.length <= max) return value;
  const dropped = value.length - max;
  return `${value.slice(0, max)}\n...[${dropped} characters trimmed when saved]`;
}

function trimValue(value: unknown, max: number, depth: number): unknown {
  if (typeof value === "string") return truncateString(value, max);
  if (depth <= 0 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const trimmed = trimValue(item, max, depth - 1);
      if (trimmed !== item) changed = true;
      return trimmed;
    });
    return changed ? next : value;
  }
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const trimmed = trimValue(item, max, depth - 1);
    if (trimmed !== item) changed = true;
    next[key] = trimmed;
  }
  return changed ? next : value;
}

function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

/**
 * Copy of a transcript fit for disk: large tool inputs and outputs of settled
 * calls are cut down. Unchanged messages and parts keep their identity.
 */
export function compactTranscript(
  messages: UIMessage[],
  max = MAX_SAVED_TOOL_STRING,
): UIMessage[] {
  let changedAny = false;
  const next = messages.map((message) => {
    let changed = false;
    const parts = message.parts.map((part) => {
      if (!isToolPart(part)) return part;
      const tool = part as {
        state?: string;
        input?: unknown;
        output?: unknown;
      };
      if (!tool.state || !SETTLED_TOOL_STATES.has(tool.state)) return part;
      const input = trimValue(tool.input, max, 8);
      const output = trimValue(tool.output, max, 8);
      if (input === tool.input && output === tool.output) return part;
      changed = true;
      return { ...part, input, output } as typeof part;
    });
    if (!changed) return message;
    changedAny = true;
    return { ...message, parts };
  });
  return changedAny ? next : messages;
}

/**
 * Splits sessions into those kept and those past the retention cap, dropping
 * the least recently active first. The active session is always kept.
 */
export function pruneSessions(
  sessions: SessionMeta[],
  activeId: string | null,
  cap = MAX_SAVED_SESSIONS,
): { keep: SessionMeta[]; drop: SessionMeta[] } {
  if (sessions.length <= cap) return { keep: sessions, drop: [] };
  const byRecency = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const kept = new Set(byRecency.slice(0, cap).map((s) => s.id));
  if (activeId && !kept.has(activeId)) {
    const lastKept = byRecency[cap - 1];
    kept.delete(lastKept.id);
    kept.add(activeId);
  }
  return {
    keep: sessions.filter((s) => kept.has(s.id)),
    drop: sessions.filter((s) => !kept.has(s.id)),
  };
}
