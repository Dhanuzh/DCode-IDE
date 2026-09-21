/**
 * VS Code injects its theme into every webview as `--vscode-*` custom
 * properties, and extension UIs are written against them. Without them a
 * webview renders with browser defaults - dark text on a dark panel - so the
 * app's own theme tokens are mapped across and injected the same way.
 */

export type ThemeKind = "dark" | "light";

/** App CSS custom properties the mapping reads, without the `--` prefix. */
export const APP_THEME_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-border",
] as const;

export type AppThemeTokens = Partial<Record<string, string>>;

type Mapping = { vscode: string; token: string };

// Only the variables extension UIs actually reach for; anything missing keeps
// the extension's own fallback value.
const MAPPINGS: Mapping[] = [
  { vscode: "foreground", token: "foreground" },
  { vscode: "descriptionForeground", token: "muted-foreground" },
  { vscode: "disabledForeground", token: "muted-foreground" },
  { vscode: "errorForeground", token: "destructive" },
  { vscode: "focusBorder", token: "ring" },
  { vscode: "contrastBorder", token: "border" },
  { vscode: "widget-border", token: "border" },
  { vscode: "widget-shadow", token: "border" },
  { vscode: "editor-background", token: "background" },
  { vscode: "editor-foreground", token: "foreground" },
  { vscode: "editorWidget-background", token: "popover" },
  { vscode: "editorWidget-foreground", token: "popover-foreground" },
  { vscode: "editorWidget-border", token: "border" },
  { vscode: "sideBar-background", token: "sidebar" },
  { vscode: "sideBar-foreground", token: "sidebar-foreground" },
  { vscode: "sideBar-border", token: "sidebar-border" },
  { vscode: "sideBarSectionHeader-background", token: "card" },
  { vscode: "sideBarSectionHeader-foreground", token: "card-foreground" },
  { vscode: "panel-background", token: "card" },
  { vscode: "panel-border", token: "border" },
  { vscode: "panelTitle-activeForeground", token: "foreground" },
  { vscode: "panelTitle-inactiveForeground", token: "muted-foreground" },
  { vscode: "button-background", token: "primary" },
  { vscode: "button-foreground", token: "primary-foreground" },
  { vscode: "button-hoverBackground", token: "primary" },
  { vscode: "button-border", token: "border" },
  { vscode: "button-secondaryBackground", token: "secondary" },
  { vscode: "button-secondaryForeground", token: "secondary-foreground" },
  { vscode: "button-secondaryHoverBackground", token: "secondary" },
  { vscode: "input-background", token: "input" },
  { vscode: "input-foreground", token: "foreground" },
  { vscode: "input-border", token: "border" },
  { vscode: "input-placeholderForeground", token: "muted-foreground" },
  { vscode: "inputOption-activeBorder", token: "ring" },
  { vscode: "dropdown-background", token: "popover" },
  { vscode: "dropdown-foreground", token: "popover-foreground" },
  { vscode: "dropdown-border", token: "border" },
  { vscode: "list-hoverBackground", token: "accent" },
  { vscode: "list-hoverForeground", token: "accent-foreground" },
  { vscode: "list-activeSelectionBackground", token: "accent" },
  { vscode: "list-activeSelectionForeground", token: "accent-foreground" },
  { vscode: "list-inactiveSelectionBackground", token: "muted" },
  { vscode: "textLink-foreground", token: "primary" },
  { vscode: "textLink-activeForeground", token: "primary" },
  { vscode: "textBlockQuote-background", token: "muted" },
  { vscode: "textBlockQuote-border", token: "border" },
  { vscode: "textCodeBlock-background", token: "muted" },
  { vscode: "textPreformat-foreground", token: "foreground" },
  { vscode: "badge-background", token: "primary" },
  { vscode: "badge-foreground", token: "primary-foreground" },
  { vscode: "progressBar-background", token: "primary" },
  { vscode: "titleBar-activeBackground", token: "card" },
  { vscode: "titleBar-activeForeground", token: "card-foreground" },
  { vscode: "menu-background", token: "popover" },
  { vscode: "menu-foreground", token: "popover-foreground" },
  { vscode: "menu-border", token: "border" },
  { vscode: "quickInput-background", token: "popover" },
  { vscode: "quickInput-foreground", token: "popover-foreground" },
  { vscode: "keybindingLabel-background", token: "muted" },
  { vscode: "keybindingLabel-foreground", token: "foreground" },
  { vscode: "keybindingLabel-border", token: "border" },
  { vscode: "scrollbarSlider-background", token: "border" },
  { vscode: "scrollbarSlider-hoverBackground", token: "muted-foreground" },
  { vscode: "scrollbarSlider-activeBackground", token: "muted-foreground" },
];

export function vscodeThemeVariables(
  tokens: AppThemeTokens,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { vscode, token } of MAPPINGS) {
    const value = tokens[token]?.trim();
    if (value) out[`--vscode-${vscode}`] = value;
  }
  return out;
}

export type WebviewThemeInput = {
  tokens: AppThemeTokens;
  kind: ThemeKind;
  fontFamily?: string;
  fontSize?: number;
};

/**
 * Stylesheet injected ahead of the extension's own styles: the mapped
 * variables plus the base rules VS Code's webview host applies.
 */
export function webviewThemeCss(input: WebviewThemeInput): string {
  const vars = vscodeThemeVariables(input.tokens);
  const family =
    input.fontFamily?.trim() ||
    "system-ui, -apple-system, 'Segoe UI', sans-serif";
  const size = input.fontSize && input.fontSize > 0 ? input.fontSize : 13;
  const declarations = [
    `--vscode-font-family: ${family}`,
    `--vscode-editor-font-family: ui-monospace, SFMono-Regular, Menlo, monospace`,
    `--vscode-font-size: ${size}px`,
    `--vscode-font-weight: normal`,
    ...Object.entries(vars).map(([name, value]) => `${name}: ${value}`),
  ];
  return `:root{${declarations.join(";")}}
html,body{margin:0;padding:0;height:100%;background:var(--vscode-editor-background, transparent);color:var(--vscode-foreground, inherit);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);}
a{color:var(--vscode-textLink-foreground, inherit);}
a:hover,a:active{color:var(--vscode-textLink-activeForeground, inherit);}
::selection{background:var(--vscode-editor-selectionBackground, var(--vscode-list-activeSelectionBackground, transparent));}`;
}

export const THEME_STYLE_ID = "dcode-webview-theme";

export function themeStyleTag(input: WebviewThemeInput): string {
  return `<style id="${THEME_STYLE_ID}">${webviewThemeCss(input)}</style>`;
}

/** Body class and attribute VS Code sets, which extension CSS keys off. */
export function themeBodyClass(kind: ThemeKind): string {
  return kind === "light" ? "vscode-light" : "vscode-dark";
}
