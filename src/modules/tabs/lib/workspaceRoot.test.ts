import { describe, expect, it } from "vitest";
import {
  isInside,
  resolveExplorerRoot,
  resolveNewTabCwd,
  type RootInput,
} from "./workspaceRoot";

const base: RootInput = {
  projectRoot: null,
  activeTerminalCwd: null,
  lastTerminalCwd: null,
  anyTerminalCwd: null,
  home: "/home/u",
};

describe("resolveExplorerRoot", () => {
  it("pins to the project root when one is open", () => {
    expect(
      resolveExplorerRoot({
        ...base,
        projectRoot: "/home/u/proj",
        activeTerminalCwd: "/tmp",
      }),
    ).toBe("/home/u/proj");
  });

  it("follows the focused terminal without a project", () => {
    expect(
      resolveExplorerRoot({ ...base, activeTerminalCwd: "/home/u/work" }),
    ).toBe("/home/u/work");
  });

  it("falls back through the last terminal, any terminal, then home", () => {
    expect(resolveExplorerRoot({ ...base, lastTerminalCwd: "/a" })).toBe("/a");
    expect(resolveExplorerRoot({ ...base, anyTerminalCwd: "/b" })).toBe("/b");
    expect(resolveExplorerRoot(base)).toBe("/home/u");
  });
});

describe("resolveNewTabCwd", () => {
  it("starts new terminals at the project root", () => {
    expect(resolveNewTabCwd({ ...base, projectRoot: "/home/u/proj" })).toBe(
      "/home/u/proj",
    );
  });

  it("keeps a terminal already inside the project where it is", () => {
    expect(
      resolveNewTabCwd({
        ...base,
        projectRoot: "/home/u/proj",
        activeTerminalCwd: "/home/u/proj/src",
      }),
    ).toBe("/home/u/proj/src");
  });

  it("pulls a terminal outside the project back to its root", () => {
    expect(
      resolveNewTabCwd({
        ...base,
        projectRoot: "/home/u/proj",
        activeTerminalCwd: "/etc",
      }),
    ).toBe("/home/u/proj");
  });

  it("inherits the focused cwd without a project", () => {
    expect(
      resolveNewTabCwd({ ...base, activeTerminalCwd: "/home/u/work" }),
    ).toBe("/home/u/work");
    expect(resolveNewTabCwd(base)).toBe("/home/u");
  });
});

describe("isInside", () => {
  it("compares across separators and drive case", () => {
    expect(isInside("/home/u/proj/src/a.ts", "/home/u/proj")).toBe(true);
    expect(isInside("C:\\Proj\\src", "c:/proj")).toBe(true);
    expect(isInside("/home/u/project", "/home/u/proj")).toBe(false);
    expect(isInside("/home/u/proj", "/home/u/proj/")).toBe(true);
  });
});
