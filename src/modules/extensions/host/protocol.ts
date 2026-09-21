/** Messages the Node extension host sends to the app. */
export type HostMessage =
  | { type: "ready"; node: string }
  | { type: "activated"; extensionId: string; commands: string[] }
  | { type: "activationFailed"; extensionId?: string; message: string }
  | { type: "deactivated" }
  | { type: "log"; level: string; message: string }
  | { type: "notify"; method: string; params: Record<string, unknown> }
  | { type: "rpc"; id: number; method: string; params: Record<string, unknown> }
  | {
      type: "commandResult";
      requestId: number;
      result?: unknown;
      error?: string;
    }
  | { type: "webviewResolved"; viewId: string }
  | { type: "webviewFailed"; viewId: string; message: string }
  | { type: "pong" };

export type HostEvent =
  | { kind: "message"; payload: HostMessage }
  | { kind: "stderr"; line: string }
  | { kind: "exit"; code: number | null };

export type HostStatus = {
  available: boolean;
  nodePath: string | null;
  nodeVersion: string | null;
  detail: string;
};

export type HostPhase = "idle" | "starting" | "activated" | "failed" | "exited";

/** Bounded so a chatty extension cannot grow the log without limit. */
export const MAX_HOST_LOG_LINES = 300;

export function appendLog(lines: string[], line: string): string[] {
  const next = [...lines, line];
  return next.length > MAX_HOST_LOG_LINES
    ? next.slice(next.length - MAX_HOST_LOG_LINES)
    : next;
}

/**
 * Every `rpc` must be answered or the extension's promise never settles. The
 * ones with no app-side meaning yet resolve to null rather than hang.
 */
export function isAnsweredLocally(method: string): boolean {
  return method === "commands.execute";
}
