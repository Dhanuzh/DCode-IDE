import { describe, expect, it } from "vitest";
import { appendLog, isAnsweredLocally, MAX_HOST_LOG_LINES } from "./protocol";

describe("appendLog", () => {
  it("appends a line", () => {
    expect(appendLog(["a"], "b")).toEqual(["a", "b"]);
  });

  it("keeps only the newest lines once the cap is hit", () => {
    const full = Array.from(
      { length: MAX_HOST_LOG_LINES },
      (_, i) => `line ${i}`,
    );
    const next = appendLog(full, "newest");
    expect(next).toHaveLength(MAX_HOST_LOG_LINES);
    expect(next[next.length - 1]).toBe("newest");
    expect(next[0]).toBe("line 1");
  });
});

describe("isAnsweredLocally", () => {
  it("marks the calls the app answers itself", () => {
    expect(isAnsweredLocally("commands.execute")).toBe(true);
    expect(isAnsweredLocally("window.showMessage")).toBe(false);
  });
});
