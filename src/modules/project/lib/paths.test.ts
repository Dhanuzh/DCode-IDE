import { describe, expect, it } from "vitest";
import { baseName, normalizePath, parentDir } from "./paths";

describe("normalizePath", () => {
  it("uses forward slashes and drops a trailing one", () => {
    expect(normalizePath("C:\\Users\\u\\proj\\")).toBe("C:/Users/u/proj");
    expect(normalizePath("/home//u/")).toBe("/home/u");
    expect(normalizePath("/")).toBe("/");
  });
});

describe("baseName", () => {
  it("returns the last segment", () => {
    expect(baseName("/home/u/proj")).toBe("proj");
    expect(baseName("C:\\proj\\app")).toBe("app");
    expect(baseName("/")).toBe("/");
  });
});

describe("parentDir", () => {
  it("walks up one level", () => {
    expect(parentDir("/home/u/proj")).toBe("/home/u");
    expect(parentDir("/home")).toBe("/");
    expect(parentDir("C:/Users/u")).toBe("C:/Users");
    expect(parentDir("C:/Users")).toBe("C:/");
  });

  it("is null at a root", () => {
    expect(parentDir("/")).toBeNull();
    expect(parentDir("C:")).toBeNull();
  });
});
