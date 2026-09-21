import { describe, expect, it } from "vitest";
import {
  AI_DOCK_DEFAULT_WIDTH,
  AI_DOCK_MAX_WIDTH,
  AI_DOCK_MIN_WIDTH,
  clampDockWidth,
  parseDockWidth,
  shouldPersistDockWidth,
} from "./dockLayout";

describe("clampDockWidth", () => {
  it("keeps a width inside the allowed range", () => {
    expect(clampDockWidth(420)).toBe(420);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(clampDockWidth(10)).toBe(AI_DOCK_MIN_WIDTH);
    expect(clampDockWidth(9999)).toBe(AI_DOCK_MAX_WIDTH);
  });

  it("rounds fractional widths", () => {
    expect(clampDockWidth(420.6)).toBe(421);
  });
});

describe("parseDockWidth", () => {
  it("falls back to the default for missing or junk values", () => {
    expect(parseDockWidth(null)).toBe(AI_DOCK_DEFAULT_WIDTH);
    expect(parseDockWidth("")).toBe(AI_DOCK_DEFAULT_WIDTH);
    expect(parseDockWidth("wide")).toBe(AI_DOCK_DEFAULT_WIDTH);
  });

  it("clamps a stored width", () => {
    expect(parseDockWidth("99999")).toBe(AI_DOCK_MAX_WIDTH);
    expect(parseDockWidth("360")).toBe(360);
  });
});

describe("shouldPersistDockWidth", () => {
  it("only persists user-driven, non-zero widths", () => {
    expect(shouldPersistDockWidth(400, true)).toBe(true);
    expect(shouldPersistDockWidth(400, false)).toBe(false);
    expect(shouldPersistDockWidth(0, true)).toBe(false);
  });
});
