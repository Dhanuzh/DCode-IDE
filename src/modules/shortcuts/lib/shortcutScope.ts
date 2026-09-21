import type { ShortcutId } from "@/modules/shortcuts/shortcuts";

function isPaneSwapShortcut(id: ShortcutId): boolean {
  return (
    id === "pane.swapLeft" ||
    id === "pane.swapRight" ||
    id === "pane.swapUp" ||
    id === "pane.swapDown"
  );
}

export function shouldDisablePaneSwapShortcut(
  id: ShortcutId,
  terminalPaneCount: number | null,
): boolean {
  return (
    isPaneSwapShortcut(id) &&
    (terminalPaneCount === null || terminalPaneCount < 2)
  );
}

export type ShortcutScope = {
  /** Kind of the active tab, or null when there is none. */
  activeKind: string | null;
  /** Panes in the active terminal tab; null when it is not a terminal. */
  terminalPaneCount: number | null;
  activeIsBlocks: boolean;
  /** Keyboard focus is inside a terminal grid. */
  focusInTerminal: boolean;
  shiftKey: boolean;
  /** Read lazily: only one shortcut needs the terminal selection. */
  hasTerminalSelection: () => boolean;
};

/**
 * Whether a global shortcut should stand aside so the key reaches the focused
 * surface instead (a disabled shortcut never calls preventDefault).
 */
export function isShortcutDisabled(
  id: ShortcutId,
  scope: ShortcutScope,
): boolean {
  if (shouldDisablePaneSwapShortcut(id, scope.terminalPaneCount)) return true;
  switch (id) {
    case "editor.undo":
    case "editor.redo":
    case "editor.aiComplete":
    case "editor.codeComplete":
      return scope.activeKind !== "editor";
    case "ai.askSelection":
      return scope.focusInTerminal && !scope.hasTerminalSelection();
    // Only intercept Cmd/Ctrl+K while a terminal is focused.
    case "terminal.clear":
      return !scope.focusInTerminal;
    case "terminal.toggleInput":
    case "blocks.prev":
    case "blocks.next":
      return !(scope.activeKind === "terminal" && scope.activeIsBlocks);
    // Ctrl+B is also Claude Code's "run in background" key: inside a terminal
    // the plain binding reaches the shell; Ctrl+Shift+B always toggles.
    case "sidebar.toggle":
      return scope.focusInTerminal && !scope.shiftKey;
    default:
      return false;
  }
}
