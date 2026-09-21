export const AI_DOCK_MIN_WIDTH = 300;
export const AI_DOCK_MAX_WIDTH = 760;
export const AI_DOCK_DEFAULT_WIDTH = 400;

const WIDTH_STORAGE_KEY = "dcode.ai-dock.width";
const OPEN_STORAGE_KEY = "dcode.ai-dock.open";
const VIEW_STORAGE_KEY = "dcode.ai-dock.view";

export function clampDockWidth(width: number): number {
  return Math.min(
    AI_DOCK_MAX_WIDTH,
    Math.max(AI_DOCK_MIN_WIDTH, Math.round(width)),
  );
}

export function parseDockWidth(raw: string | null): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed)
    ? clampDockWidth(parsed)
    : AI_DOCK_DEFAULT_WIDTH;
}

export function shouldPersistDockWidth(
  width: number,
  isUserInteraction: boolean,
): boolean {
  return isUserInteraction && width > 0;
}

export function readDockWidth(): number {
  try {
    return parseDockWidth(window.localStorage.getItem(WIDTH_STORAGE_KEY));
  } catch {
    return AI_DOCK_DEFAULT_WIDTH;
  }
}

export function writeDockWidth(width: number): void {
  try {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
  } catch {
    // storage may fail in private mode
  }
}

export function readDockOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDockOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    // storage may fail in private mode
  }
}

/** Which surface the right dock shows: the built-in agent or an extension. */
export type DockView = "ai" | "extension";

export function readDockView(): DockView {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "extension"
      ? "extension"
      : "ai";
  } catch {
    return "ai";
  }
}

export function writeDockView(view: DockView): void {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // storage may fail in private mode
  }
}
