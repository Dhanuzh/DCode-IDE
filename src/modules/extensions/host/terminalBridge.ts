/**
 * Terminals an extension asks for. The host emits `terminal.*` notifications;
 * the app owns tabs, so it registers the handlers here the same way the LSP
 * navigator is registered.
 */

export type ExtTerminalOptions = {
  name?: string;
  cwd?: string;
  shellPath?: string;
  shellArgs?: string[] | string;
  env?: Record<string, string | null>;
};

export type ExtTerminalBridge = {
  create: (id: string, options: ExtTerminalOptions) => void;
  sendText: (id: string, text: string, addNewLine: boolean) => void;
  show: (id: string) => void;
  dispose: (id: string) => void;
};

let bridge: ExtTerminalBridge | null = null;

export function setExtTerminalBridge(next: ExtTerminalBridge | null): void {
  bridge = next;
}

export function extTerminalBridge(): ExtTerminalBridge | null {
  return bridge;
}

/** Terminal input is typed into a live shell, so control bytes are refused. */
export function sanitizeTerminalText(text: string): string | null {
  if (typeof text !== "string" || text.length === 0) return null;
  if (text.length > 8192) return null;
  // Submitting is the extension's job to request through `addNewLine`, so a
  // newline - or any other control byte - inside the text is refused.
  return /[\u0000-\u001f\u007f]/.test(text) ? null : text;
}
