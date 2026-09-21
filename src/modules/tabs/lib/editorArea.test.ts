import { describe, expect, it } from "vitest";
import {
  isPanelTab,
  resolveEditorAreaId,
  resolvePanelTerminalId,
  stripGapToSpaceGap,
} from "./editorArea";
import { reorderTabsByGap, type Tab } from "./useTabs";

function term(id: number): Tab {
  return {
    id,
    kind: "terminal",
    spaceId: "a",
    title: "shell",
    paneTree: { kind: "leaf", id: id * 10 },
    activeLeafId: id * 10,
  } as Tab;
}

function editor(id: number): Tab {
  return {
    id,
    kind: "editor",
    spaceId: "a",
    title: `f${id}.ts`,
    path: `/w/f${id}.ts`,
    dirty: false,
  } as Tab;
}

describe("isPanelTab", () => {
  it("routes only terminals to the panel", () => {
    expect(isPanelTab(term(1))).toBe(true);
    expect(isPanelTab(editor(2))).toBe(false);
  });
});

describe("resolveEditorAreaId", () => {
  it("shows the active tab when it is an editor-area tab", () => {
    expect(resolveEditorAreaId([term(1), editor(2), editor(3)], 2, 3)).toBe(2);
  });

  it("keeps the last editor tab on screen while a terminal is focused", () => {
    expect(resolveEditorAreaId([editor(2), editor(3), term(1)], 1, 2)).toBe(2);
  });

  it("falls back to the newest editor tab when the last one closed", () => {
    expect(resolveEditorAreaId([editor(2), editor(3), term(1)], 1, 9)).toBe(3);
  });

  it("ignores a stale last id that now names a terminal", () => {
    expect(resolveEditorAreaId([editor(2), term(1)], 1, 1)).toBe(2);
  });

  it("is null when the space has only terminals", () => {
    expect(resolveEditorAreaId([term(1), term(4)], 1, null)).toBeNull();
  });
});

describe("resolvePanelTerminalId", () => {
  it("shows the active terminal", () => {
    expect(resolvePanelTerminalId([term(1), term(4), editor(2)], 4, 1)).toBe(4);
  });

  it("keeps the selected terminal while an editor is focused", () => {
    expect(resolvePanelTerminalId([term(1), term(4), editor(2)], 2, 1)).toBe(1);
  });

  it("falls back to the newest terminal when the selection is gone", () => {
    expect(resolvePanelTerminalId([term(1), term(4), editor(2)], 2, 7)).toBe(4);
  });

  it("is null when the space has no terminals", () => {
    expect(resolvePanelTerminalId([editor(2)], 2, null)).toBeNull();
  });
});

describe("stripGapToSpaceGap", () => {
  const space = [term(1), editor(2), term(3), editor(4), editor(5)];
  const strip = space.filter((t) => !isPanelTab(t));
  const order = (tabs: Tab[]) =>
    tabs.filter((t) => !isPanelTab(t)).map((t) => t.id);
  const move = (fromId: number, gap: number) =>
    order(
      reorderTabsByGap(space, fromId, stripGapToSpaceGap(space, strip, gap)),
    );

  it("moves an editor tab to the end of the strip", () => {
    expect(move(2, 3)).toEqual([4, 5, 2]);
  });

  it("moves an editor tab to the front of the strip", () => {
    expect(move(5, 0)).toEqual([5, 2, 4]);
  });

  it("moves an editor tab between two others", () => {
    expect(move(2, 2)).toEqual([4, 2, 5]);
  });

  it("keeps terminals in their relative order", () => {
    const next = reorderTabsByGap(
      space,
      2,
      stripGapToSpaceGap(space, strip, 3),
    );
    expect(next.filter(isPanelTab).map((t) => t.id)).toEqual([1, 3]);
  });
});
