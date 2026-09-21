import { describe, expect, it } from "vitest";
import {
  isShortcutDisabled,
  type ShortcutScope,
  shouldDisablePaneSwapShortcut,
} from "@/modules/shortcuts/lib/shortcutScope";

describe("shouldDisablePaneSwapShortcut", () => {
  it.each([
    "pane.swapLeft",
    "pane.swapRight",
    "pane.swapUp",
    "pane.swapDown",
  ] as const)("disables %s outside multi-pane terminals", (id) => {
    expect(shouldDisablePaneSwapShortcut(id, null)).toBe(true);
    expect(shouldDisablePaneSwapShortcut(id, 1)).toBe(true);
    expect(shouldDisablePaneSwapShortcut(id, 2)).toBe(false);
  });

  it("rejects unrelated shortcuts", () => {
    expect(shouldDisablePaneSwapShortcut("pane.focusNext", null)).toBe(false);
    expect(shouldDisablePaneSwapShortcut("editor.undo", 1)).toBe(false);
  });
});

describe("isShortcutDisabled", () => {
  const base: ShortcutScope = {
    activeKind: "terminal",
    terminalPaneCount: 1,
    activeIsBlocks: false,
    focusInTerminal: false,
    shiftKey: false,
    hasTerminalSelection: () => false,
  };

  it("keeps editor shortcuts to editor tabs", () => {
    expect(isShortcutDisabled("editor.undo", base)).toBe(true);
    expect(
      isShortcutDisabled("editor.undo", { ...base, activeKind: "editor" }),
    ).toBe(false);
  });

  it("lets terminal keys through outside a terminal", () => {
    expect(isShortcutDisabled("terminal.clear", base)).toBe(true);
    expect(
      isShortcutDisabled("terminal.clear", { ...base, focusInTerminal: true }),
    ).toBe(false);
  });

  it("asks about a terminal selection only when there is one", () => {
    const inTerm = { ...base, focusInTerminal: true };
    expect(isShortcutDisabled("ai.askSelection", inTerm)).toBe(true);
    expect(
      isShortcutDisabled("ai.askSelection", {
        ...inTerm,
        hasTerminalSelection: () => true,
      }),
    ).toBe(false);
    expect(isShortcutDisabled("ai.askSelection", base)).toBe(false);
  });

  it("leaves plain Ctrl+B to a focused terminal", () => {
    const inTerm = { ...base, focusInTerminal: true };
    expect(isShortcutDisabled("sidebar.toggle", inTerm)).toBe(true);
    expect(
      isShortcutDisabled("sidebar.toggle", { ...inTerm, shiftKey: true }),
    ).toBe(false);
    expect(isShortcutDisabled("sidebar.toggle", base)).toBe(false);
  });

  it("scopes block navigation to block tabs", () => {
    expect(isShortcutDisabled("blocks.next", base)).toBe(true);
    expect(
      isShortcutDisabled("blocks.next", { ...base, activeIsBlocks: true }),
    ).toBe(false);
  });

  it("needs two panes to swap", () => {
    expect(isShortcutDisabled("pane.swapLeft", base)).toBe(true);
    expect(
      isShortcutDisabled("pane.swapLeft", { ...base, terminalPaneCount: 2 }),
    ).toBe(false);
  });
});
