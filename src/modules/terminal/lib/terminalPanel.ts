export const TERMINAL_PANEL_MIN_HEIGHT = 120;
export const TERMINAL_PANEL_DEFAULT_HEIGHT = 260;
/** The panel may never swallow the whole editor area. */
export const TERMINAL_PANEL_MAX_RATIO = 0.8;

const HEIGHT_STORAGE_KEY = "dcode.terminal-panel.height";
const OPEN_STORAGE_KEY = "dcode.terminal-panel.open";
const MAXIMIZED_STORAGE_KEY = "dcode.terminal-panel.maximized";

export function clampPanelHeight(height: number, available: number): number {
  const ceiling = Math.max(
    TERMINAL_PANEL_MIN_HEIGHT,
    Math.floor(available * TERMINAL_PANEL_MAX_RATIO),
  );
  return Math.min(
    ceiling,
    Math.max(TERMINAL_PANEL_MIN_HEIGHT, Math.round(height)),
  );
}

export function parsePanelHeight(raw: string | null): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= TERMINAL_PANEL_MIN_HEIGHT
    ? Math.round(parsed)
    : TERMINAL_PANEL_DEFAULT_HEIGHT;
}

/** Dragging the divider up grows the panel, so height moves opposite to Y. */
export function heightFromDrag(
  startHeight: number,
  startY: number,
  currentY: number,
  available: number,
): number {
  return clampPanelHeight(startHeight + (startY - currentY), available);
}

export function readPanelHeight(): number {
  try {
    return parsePanelHeight(window.localStorage.getItem(HEIGHT_STORAGE_KEY));
  } catch {
    return TERMINAL_PANEL_DEFAULT_HEIGHT;
  }
}

export function writePanelHeight(height: number): void {
  try {
    window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(height));
  } catch {
    // storage may fail in private mode
  }
}

export function readPanelOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writePanelOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    // storage may fail in private mode
  }
}

export function readPanelMaximized(): boolean {
  try {
    return window.localStorage.getItem(MAXIMIZED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writePanelMaximized(maximized: boolean): void {
  try {
    window.localStorage.setItem(MAXIMIZED_STORAGE_KEY, maximized ? "1" : "0");
  } catch {
    // storage may fail in private mode
  }
}
