import type {
  Theme,
  ThemeColors,
  TerminalPalette,
} from "@/modules/theme/types";

export type VsCodeThemeFile = {
  name?: string;
  type?: string;
  include?: string;
  colors?: Record<string, unknown>;
};

const HEX_RE = /^#[0-9a-f]{3,8}$/i;

type Palette = Record<string, string>;

/** Keeps only the `#rgb[a]` / `#rrggbb[aa]` forms VS Code themes use. */
export function normalizePalette(
  raw: Record<string, unknown> | undefined,
): Palette {
  const out: Palette = {};
  if (!raw) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!HEX_RE.test(trimmed)) continue;
    out[key] = trimmed.toLowerCase();
  }
  return out;
}

/** Later files win, so a theme's own colors override the ones it includes. */
export function mergePalettes(base: Palette, override: Palette): Palette {
  return { ...base, ...override };
}

export function resolveMode(
  uiTheme: string,
  type: string | undefined,
): "light" | "dark" {
  if (type === "light" || type === "hcLight") return "light";
  if (type === "dark" || type === "hc" || type === "hcBlack") return "dark";
  return uiTheme === "vs" ? "light" : "dark";
}

function pick(palette: Palette, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = palette[key];
    if (value) return value;
  }
  return undefined;
}

function put(
  target: ThemeColors,
  key: keyof ThemeColors,
  value: string | undefined,
): void {
  if (value) target[key] = value;
}

export function toThemeColors(palette: Palette): ThemeColors {
  const colors: ThemeColors = {};
  const background = pick(palette, "editor.background");
  const foreground = pick(palette, "editor.foreground", "foreground");
  const sidebarBg = pick(
    palette,
    "sideBar.background",
    "activityBar.background",
  );
  const border = pick(
    palette,
    "panel.border",
    "editorGroup.border",
    "sideBar.border",
    "contrastBorder",
    "widget.border",
  );
  const accent = pick(
    palette,
    "list.activeSelectionBackground",
    "list.hoverBackground",
    "toolbar.hoverBackground",
  );
  const primary = pick(
    palette,
    "button.background",
    "textLink.foreground",
    "focusBorder",
  );

  put(colors, "background", background);
  put(colors, "foreground", foreground);
  put(
    colors,
    "card",
    sidebarBg ??
      pick(palette, "editorGroupHeader.tabsBackground") ??
      background,
  );
  put(
    colors,
    "cardForeground",
    pick(palette, "sideBar.foreground") ?? foreground,
  );
  put(
    colors,
    "popover",
    pick(palette, "editorWidget.background", "menu.background") ?? sidebarBg,
  );
  put(
    colors,
    "popoverForeground",
    pick(palette, "editorWidget.foreground", "menu.foreground") ?? foreground,
  );
  put(colors, "primary", primary);
  put(colors, "primaryForeground", pick(palette, "button.foreground"));
  put(
    colors,
    "secondary",
    pick(palette, "badge.background", "editorWidget.background"),
  );
  put(colors, "secondaryForeground", pick(palette, "badge.foreground"));
  put(
    colors,
    "muted",
    pick(palette, "input.background", "editorGroupHeader.tabsBackground"),
  );
  put(
    colors,
    "mutedForeground",
    pick(
      palette,
      "descriptionForeground",
      "tab.inactiveForeground",
      "editorLineNumber.foreground",
    ),
  );
  put(colors, "accent", accent);
  put(
    colors,
    "accentForeground",
    pick(palette, "list.activeSelectionForeground") ?? foreground,
  );
  put(
    colors,
    "destructive",
    pick(
      palette,
      "errorForeground",
      "editorError.foreground",
      "inputValidation.errorBorder",
    ),
  );
  put(colors, "border", border);
  put(colors, "input", pick(palette, "input.background") ?? background);
  put(colors, "ring", pick(palette, "focusBorder") ?? primary);
  put(colors, "sidebar", sidebarBg);
  put(
    colors,
    "sidebarForeground",
    pick(palette, "sideBar.foreground") ?? foreground,
  );
  put(
    colors,
    "sidebarPrimary",
    pick(palette, "activityBarBadge.background") ?? primary,
  );
  put(
    colors,
    "sidebarPrimaryForeground",
    pick(palette, "activityBarBadge.foreground"),
  );
  put(colors, "sidebarAccent", accent);
  put(
    colors,
    "sidebarAccentForeground",
    pick(palette, "list.activeSelectionForeground"),
  );
  put(colors, "sidebarBorder", pick(palette, "sideBar.border") ?? border);
  put(colors, "sidebarRing", pick(palette, "focusBorder"));
  return colors;
}

const ANSI_KEYS = [
  "terminal.ansiBlack",
  "terminal.ansiRed",
  "terminal.ansiGreen",
  "terminal.ansiYellow",
  "terminal.ansiBlue",
  "terminal.ansiMagenta",
  "terminal.ansiCyan",
  "terminal.ansiWhite",
  "terminal.ansiBrightBlack",
  "terminal.ansiBrightRed",
  "terminal.ansiBrightGreen",
  "terminal.ansiBrightYellow",
  "terminal.ansiBrightBlue",
  "terminal.ansiBrightMagenta",
  "terminal.ansiBrightCyan",
  "terminal.ansiBrightWhite",
] as const;

export function toTerminalPalette(palette: Palette): TerminalPalette {
  const terminal: TerminalPalette = {};
  const background = pick(palette, "terminal.background", "editor.background");
  const foreground = pick(palette, "terminal.foreground", "editor.foreground");
  if (background) terminal.background = background;
  if (foreground) terminal.foreground = foreground;
  const cursor =
    pick(palette, "terminalCursor.foreground", "editorCursor.foreground") ??
    foreground;
  if (cursor) terminal.cursor = cursor;
  const cursorAccent = pick(palette, "terminalCursor.background");
  if (cursorAccent) terminal.cursorAccent = cursorAccent;
  const selection = pick(
    palette,
    "terminal.selectionBackground",
    "editor.selectionBackground",
  );
  if (selection) terminal.selection = selection;

  const ansi = ANSI_KEYS.map((key) => palette[key]);
  // The palette is all-or-nothing: a partial one would mix two themes' hues.
  if (ansi.every((c): c is string => Boolean(c))) {
    terminal.ansi = ansi as unknown as TerminalPalette["ansi"];
  }
  return terminal;
}

/** Theme ids must satisfy the store's `^[a-z0-9][a-z0-9-]{1,63}$`. */
export function themeIdFor(extensionId: string, label: string): string {
  const slug = `vsx-${extensionId}-${label}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .replace(/-{2,}/g, "-");
  const trimmed = slug.slice(0, 64);
  return trimmed.length >= 2 ? trimmed : "vsx-theme";
}

export function convertVsCodeTheme(args: {
  extensionId: string;
  label: string;
  uiTheme: string;
  publisher: string;
  file: VsCodeThemeFile;
  palette: Palette;
}): Theme {
  const mode = resolveMode(args.uiTheme, args.file.type);
  const variant = {
    colors: toThemeColors(args.palette),
    terminal: toTerminalPalette(args.palette),
  };
  const theme: Theme = {
    id: themeIdFor(args.extensionId, args.label),
    name: args.file.name?.trim() || args.label,
    variants: mode === "light" ? { light: variant } : { dark: variant },
  };
  if (args.publisher) theme.author = args.publisher;
  theme.description = `Imported from ${args.extensionId}`;
  return theme;
}

/**
 * Which of an extension's themes to switch to after installing it. A pack ships
 * several variants (Latte/Frappe/Macchiato/Mocha); take one that matches the
 * mode already in use rather than flipping the user light/dark.
 */
export function pickThemeForMode(
  themes: Theme[],
  mode: "light" | "dark",
): Theme | null {
  return themes.find((t) => t.variants[mode]) ?? themes[0] ?? null;
}
