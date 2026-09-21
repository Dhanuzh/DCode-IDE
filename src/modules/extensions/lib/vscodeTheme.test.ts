import { describe, expect, it } from "vitest";
import type { Theme } from "@/modules/theme/types";
import {
  convertVsCodeTheme,
  mergePalettes,
  normalizePalette,
  resolveMode,
  pickThemeForMode,
  themeIdFor,
  toTerminalPalette,
  toThemeColors,
} from "./vscodeTheme";

const ANSI = {
  "terminal.ansiBlack": "#000000",
  "terminal.ansiRed": "#ff0000",
  "terminal.ansiGreen": "#00ff00",
  "terminal.ansiYellow": "#ffff00",
  "terminal.ansiBlue": "#0000ff",
  "terminal.ansiMagenta": "#ff00ff",
  "terminal.ansiCyan": "#00ffff",
  "terminal.ansiWhite": "#ffffff",
  "terminal.ansiBrightBlack": "#111111",
  "terminal.ansiBrightRed": "#ff1111",
  "terminal.ansiBrightGreen": "#11ff11",
  "terminal.ansiBrightYellow": "#ffff11",
  "terminal.ansiBrightBlue": "#1111ff",
  "terminal.ansiBrightMagenta": "#ff11ff",
  "terminal.ansiBrightCyan": "#11ffff",
  "terminal.ansiBrightWhite": "#f0f0f0",
};

describe("normalizePalette", () => {
  it("keeps hex colors and drops everything else", () => {
    expect(
      normalizePalette({
        "editor.background": "#282A36",
        "editor.foreground": " #F8F8F2 ",
        "some.number": 42,
        "some.named": "rebeccapurple",
        "some.alpha": "#FFFFFF80",
      }),
    ).toEqual({
      "editor.background": "#282a36",
      "editor.foreground": "#f8f8f2",
      "some.alpha": "#ffffff80",
    });
  });

  it("returns an empty palette for missing colors", () => {
    expect(normalizePalette(undefined)).toEqual({});
  });
});

describe("mergePalettes", () => {
  it("lets the including theme override its base", () => {
    expect(
      mergePalettes({ a: "#000000", b: "#111111" }, { b: "#222222" }),
    ).toEqual({ a: "#000000", b: "#222222" });
  });
});

describe("resolveMode", () => {
  it("prefers the file's declared type", () => {
    expect(resolveMode("vs-dark", "light")).toBe("light");
    expect(resolveMode("vs", "dark")).toBe("dark");
  });

  it("falls back to uiTheme", () => {
    expect(resolveMode("vs", undefined)).toBe("light");
    expect(resolveMode("vs-dark", undefined)).toBe("dark");
    expect(resolveMode("hc-black", undefined)).toBe("dark");
  });
});

describe("toThemeColors", () => {
  it("maps the core VS Code keys onto app tokens", () => {
    const colors = toThemeColors({
      "editor.background": "#282a36",
      "editor.foreground": "#f8f8f2",
      "sideBar.background": "#21222c",
      "button.background": "#bd93f9",
      "list.activeSelectionBackground": "#44475a",
      "panel.border": "#191a21",
      descriptionForeground: "#6272a4",
    });
    expect(colors.background).toBe("#282a36");
    expect(colors.foreground).toBe("#f8f8f2");
    expect(colors.card).toBe("#21222c");
    expect(colors.sidebar).toBe("#21222c");
    expect(colors.primary).toBe("#bd93f9");
    expect(colors.accent).toBe("#44475a");
    expect(colors.border).toBe("#191a21");
    expect(colors.mutedForeground).toBe("#6272a4");
  });

  it("omits tokens with no source color instead of inventing one", () => {
    const colors = toThemeColors({ "editor.background": "#000000" });
    expect(colors.background).toBe("#000000");
    expect(colors.primary).toBeUndefined();
    expect(colors.border).toBeUndefined();
  });
});

describe("toTerminalPalette", () => {
  it("takes the full ansi ramp when every slot is present", () => {
    const terminal = toTerminalPalette({
      "terminal.background": "#282a36",
      "terminal.foreground": "#f8f8f2",
      ...ANSI,
    });
    expect(terminal.background).toBe("#282a36");
    expect(terminal.ansi).toHaveLength(16);
    expect(terminal.ansi?.[0]).toBe("#000000");
  });

  it("drops a partial ansi ramp", () => {
    const { "terminal.ansiBrightWhite": _dropped, ...partial } = ANSI;
    expect(toTerminalPalette(partial).ansi).toBeUndefined();
  });

  it("falls back to editor colors when the terminal has none", () => {
    const terminal = toTerminalPalette({
      "editor.background": "#101010",
      "editor.foreground": "#e0e0e0",
    });
    expect(terminal.background).toBe("#101010");
    expect(terminal.foreground).toBe("#e0e0e0");
  });

  it("falls back to the foreground for the cursor, as VS Code does", () => {
    expect(toTerminalPalette({ "editor.foreground": "#e0e0e0" }).cursor).toBe(
      "#e0e0e0",
    );
    expect(
      toTerminalPalette({
        "editor.foreground": "#e0e0e0",
        "terminalCursor.foreground": "#ff0000",
      }).cursor,
    ).toBe("#ff0000");
  });
});

describe("themeIdFor", () => {
  it("builds a store-safe kebab id", () => {
    expect(themeIdFor("dracula-theme.theme-dracula", "Dracula Soft")).toBe(
      "vsx-dracula-theme-theme-dracula-dracula-soft",
    );
  });

  it("collapses punctuation and caps the length", () => {
    const id = themeIdFor("a.b", "One  Dark++ (Pro)");
    expect(id).toBe("vsx-a-b-one-dark-pro");
    expect(themeIdFor("x".repeat(80), "y").length).toBeLessThanOrEqual(64);
  });

  it("matches the theme store's id rule", () => {
    expect(
      /^[a-z0-9][a-z0-9-]{1,63}$/.test(themeIdFor("a.b", "Night Owl")),
    ).toBe(true);
  });
});

describe("convertVsCodeTheme", () => {
  it("produces a dark variant theme with author and description", () => {
    const theme = convertVsCodeTheme({
      extensionId: "dracula-theme.theme-dracula",
      label: "Dracula",
      uiTheme: "vs-dark",
      publisher: "dracula-theme",
      file: { name: "Dracula", type: "dark" },
      palette: {
        "editor.background": "#282a36",
        "editor.foreground": "#f8f8f2",
      },
    });
    expect(theme.variants.dark?.colors?.background).toBe("#282a36");
    expect(theme.variants.light).toBeUndefined();
    expect(theme.author).toBe("dracula-theme");
    expect(theme.name).toBe("Dracula");
  });

  it("puts a light theme in the light slot", () => {
    const theme = convertVsCodeTheme({
      extensionId: "a.b",
      label: "Solarized Light",
      uiTheme: "vs",
      publisher: "",
      file: {},
      palette: { "editor.background": "#fdf6e3" },
    });
    expect(theme.variants.light?.colors?.background).toBe("#fdf6e3");
    expect(theme.variants.dark).toBeUndefined();
    expect(theme.name).toBe("Solarized Light");
  });
});

describe("pickThemeForMode", () => {
  const dark: Theme = { id: "d", name: "Dark", variants: { dark: {} } };
  const light: Theme = { id: "l", name: "Light", variants: { light: {} } };

  it("prefers a variant matching the mode in use", () => {
    expect(pickThemeForMode([light, dark], "dark")).toBe(dark);
    expect(pickThemeForMode([dark, light], "light")).toBe(light);
  });

  it("falls back to the first theme when no variant matches", () => {
    expect(pickThemeForMode([dark], "light")).toBe(dark);
  });

  it("returns null when the extension contributed no themes", () => {
    expect(pickThemeForMode([], "dark")).toBeNull();
  });
});
