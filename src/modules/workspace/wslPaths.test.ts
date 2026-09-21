import { describe, expect, it } from "vitest";
import { windowsToWsl, wslToWindows } from "./wslPaths";

describe("wslToWindows", () => {
  it("maps the distro filesystem to its UNC share", () => {
    expect(wslToWindows("/home/u/proj", "archlinux")).toBe(
      "\\\\wsl.localhost\\archlinux\\home\\u\\proj",
    );
    expect(wslToWindows("/", "archlinux")).toBe(
      "\\\\wsl.localhost\\archlinux\\",
    );
  });

  it("maps a drvfs mount back to its drive", () => {
    expect(wslToWindows("/mnt/d/projects", "archlinux")).toBe("D:\\projects");
    expect(wslToWindows("/mnt/c", "archlinux")).toBe("C:\\");
  });
});

describe("windowsToWsl", () => {
  it("maps the distro share back to a distro path", () => {
    expect(
      windowsToWsl("\\\\wsl.localhost\\archlinux\\home\\u\\proj", "archlinux"),
    ).toBe("/home/u/proj");
    expect(windowsToWsl("\\\\wsl$\\archlinux\\home\\u", "ArchLinux")).toBe(
      "/home/u",
    );
  });

  it("maps a drive to its mount point", () => {
    expect(windowsToWsl("D:\\projects\\app", "archlinux")).toBe(
      "/mnt/d/projects/app",
    );
    expect(windowsToWsl("C:\\", "archlinux")).toBe("/mnt/c");
  });

  it("refuses another distro", () => {
    expect(
      windowsToWsl("\\\\wsl.localhost\\ubuntu\\home\\u", "archlinux"),
    ).toBeNull();
  });

  it("passes a unix path through and rejects a relative one", () => {
    expect(windowsToWsl("/home/u/proj/", "archlinux")).toBe("/home/u/proj");
    expect(windowsToWsl("proj", "archlinux")).toBeNull();
  });
});
