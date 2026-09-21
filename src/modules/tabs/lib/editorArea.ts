import type { Tab } from "./tabTypes";

/** Terminal tabs live in the bottom panel; every other kind in the editor area. */
export function isPanelTab(tab: Tab): boolean {
  return tab.kind === "terminal";
}

/**
 * The tab the editor area shows: the active tab when it belongs there, else
 * the last editor-area tab that was active, else the newest one in the space.
 * Null when the space has no editor-area tabs at all.
 */
export function resolveEditorAreaId(
  spaceTabs: Tab[],
  activeId: number,
  lastEditorAreaId: number | null,
): number | null {
  const active = spaceTabs.find((t) => t.id === activeId);
  if (active && !isPanelTab(active)) return active.id;
  if (
    lastEditorAreaId !== null &&
    spaceTabs.some((t) => t.id === lastEditorAreaId && !isPanelTab(t))
  ) {
    return lastEditorAreaId;
  }
  for (let i = spaceTabs.length - 1; i >= 0; i--) {
    if (!isPanelTab(spaceTabs[i])) return spaceTabs[i].id;
  }
  return null;
}

/**
 * The terminal the panel shows: the active one when a terminal is focused,
 * else the one the panel was last pointed at, else the newest.
 */
export function resolvePanelTerminalId(
  spaceTabs: Tab[],
  activeId: number,
  selectedId: number | null,
): number | null {
  const active = spaceTabs.find((t) => t.id === activeId);
  if (active && isPanelTab(active)) return active.id;
  if (
    selectedId !== null &&
    spaceTabs.some((t) => t.id === selectedId && isPanelTab(t))
  ) {
    return selectedId;
  }
  for (let i = spaceTabs.length - 1; i >= 0; i--) {
    if (isPanelTab(spaceTabs[i])) return spaceTabs[i].id;
  }
  return null;
}

/**
 * Maps an insertion gap in a filtered strip (the editor-area tab bar) onto the
 * space's full tab order, which `reorderTabsByGap` expects.
 */
export function stripGapToSpaceGap(
  spaceTabs: Tab[],
  strip: Tab[],
  gap: number,
): number {
  if (strip.length === 0) return gap;
  if (gap < strip.length) {
    return spaceTabs.findIndex((t) => t.id === strip[gap].id);
  }
  const last = strip[strip.length - 1].id;
  return spaceTabs.findIndex((t) => t.id === last) + 1;
}
