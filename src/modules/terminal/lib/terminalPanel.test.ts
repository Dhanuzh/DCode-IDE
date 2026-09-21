import { describe, expect, it } from "vitest";
import {
  clampPanelHeight,
  heightFromDrag,
  parsePanelHeight,
  TERMINAL_PANEL_DEFAULT_HEIGHT,
  TERMINAL_PANEL_MIN_HEIGHT,
} from "./terminalPanel";

describe("clampPanelHeight", () => {
  it("keeps a height inside the allowed band", () => {
    expect(clampPanelHeight(300, 1000)).toBe(300);
  });

  it("enforces the minimum", () => {
    expect(clampPanelHeight(10, 1000)).toBe(TERMINAL_PANEL_MIN_HEIGHT);
  });

  it("never takes more than 80% of the available height", () => {
    expect(clampPanelHeight(950, 1000)).toBe(800);
  });

  it("keeps the minimum usable in a very short window", () => {
    expect(clampPanelHeight(500, 100)).toBe(TERMINAL_PANEL_MIN_HEIGHT);
  });
});

describe("parsePanelHeight", () => {
  it("falls back to the default for missing or junk values", () => {
    expect(parsePanelHeight(null)).toBe(TERMINAL_PANEL_DEFAULT_HEIGHT);
    expect(parsePanelHeight("tall")).toBe(TERMINAL_PANEL_DEFAULT_HEIGHT);
    expect(parsePanelHeight("10")).toBe(TERMINAL_PANEL_DEFAULT_HEIGHT);
  });

  it("reads a stored height", () => {
    expect(parsePanelHeight("340")).toBe(340);
  });
});

describe("heightFromDrag", () => {
  it("grows the panel when the divider is dragged up", () => {
    expect(heightFromDrag(200, 500, 400, 1000)).toBe(300);
  });

  it("shrinks the panel when dragged down", () => {
    expect(heightFromDrag(300, 400, 500, 1000)).toBe(200);
  });

  it("clamps at the bounds", () => {
    expect(heightFromDrag(200, 500, 5000, 1000)).toBe(
      TERMINAL_PANEL_MIN_HEIGHT,
    );
    expect(heightFromDrag(200, 500, -5000, 1000)).toBe(800);
  });
});
