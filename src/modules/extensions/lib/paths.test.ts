import { describe, expect, it } from "vitest";
import { resolveRelative } from "./paths";

describe("resolveRelative", () => {
  it("resolves a sibling file", () => {
    expect(resolveRelative("./themes/dark.json", "./base.json")).toBe(
      "themes/base.json",
    );
  });

  it("resolves a parent-relative file", () => {
    expect(resolveRelative("themes/dark/main.json", "../shared.json")).toBe(
      "themes/shared.json",
    );
  });

  it("resolves from a file at the root", () => {
    expect(resolveRelative("theme.json", "colors.json")).toBe("colors.json");
  });

  it("refuses to climb above the extension root", () => {
    expect(resolveRelative("theme.json", "../../etc/passwd")).toBeNull();
    expect(resolveRelative("themes/dark.json", "../../x.json")).toBeNull();
  });

  it("normalizes windows separators", () => {
    expect(resolveRelative("themes\\dark.json", ".\\base.json")).toBe(
      "themes/base.json",
    );
  });
});
