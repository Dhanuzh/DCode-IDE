import { describe, expect, it } from "vitest";
import {
  themeBodyClass,
  themeStyleTag,
  THEME_STYLE_ID,
  vscodeThemeVariables,
  webviewThemeCss,
} from "./webviewTheme";

const tokens = {
  background: "oklch(0.2 0 0)",
  foreground: "oklch(0.95 0 0)",
  primary: "#c96442",
  "primary-foreground": "#fff",
  "muted-foreground": "  #999  ",
  border: "",
};

describe("vscodeThemeVariables", () => {
  it("maps app tokens onto the variables extensions read", () => {
    const vars = vscodeThemeVariables(tokens);
    expect(vars["--vscode-foreground"]).toBe("oklch(0.95 0 0)");
    expect(vars["--vscode-editor-background"]).toBe("oklch(0.2 0 0)");
    expect(vars["--vscode-button-background"]).toBe("#c96442");
    expect(vars["--vscode-button-foreground"]).toBe("#fff");
  });

  it("trims values and drops empty ones so fallbacks survive", () => {
    const vars = vscodeThemeVariables(tokens);
    expect(vars["--vscode-descriptionForeground"]).toBe("#999");
    expect(vars["--vscode-panel-border"]).toBeUndefined();
  });

  it("returns nothing for an empty theme", () => {
    expect(vscodeThemeVariables({})).toEqual({});
  });
});

describe("webviewThemeCss", () => {
  it("always defines the font variables", () => {
    const css = webviewThemeCss({ tokens: {}, kind: "dark" });
    expect(css).toContain("--vscode-font-family:");
    expect(css).toContain("--vscode-font-size: 13px");
  });

  it("honours an explicit font", () => {
    const css = webviewThemeCss({
      tokens: {},
      kind: "light",
      fontFamily: "Inter",
      fontSize: 15,
    });
    expect(css).toContain("--vscode-font-family: Inter");
    expect(css).toContain("--vscode-font-size: 15px");
  });
});

describe("theme tag and body class", () => {
  it("tags the style element so live updates can find it", () => {
    expect(themeStyleTag({ tokens, kind: "dark" })).toContain(
      `<style id="${THEME_STYLE_ID}">`,
    );
  });

  it("names the class extension stylesheets key off", () => {
    expect(themeBodyClass("dark")).toBe("vscode-dark");
    expect(themeBodyClass("light")).toBe("vscode-light");
  });
});
