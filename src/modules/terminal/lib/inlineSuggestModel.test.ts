import { describe, expect, it } from "vitest";
import {
  type BufferLike,
  fitGhost,
  ghostFor,
  isRecordableCommand,
  readFullInput,
  readPromptInput,
} from "./inlineSuggestModel";

const COLS = 20;

// Rows are exactly COLS wide; a leading "~" marks a soft-wrapped row.
function buffer(rows: string[]): BufferLike {
  return {
    getLine(y) {
      const raw = rows[y];
      if (raw === undefined) return undefined;
      const isWrapped = raw.startsWith("~");
      const text = (isWrapped ? raw.slice(1) : raw).padEnd(COLS, " ");
      return {
        isWrapped,
        translateToString(trimRight = false, start = 0, end = COLS) {
          const s = text.slice(start, end);
          return trimRight ? s.replace(/\s+$/, "") : s;
        },
      };
    },
  };
}

describe("readPromptInput", () => {
  it("reads typed text after the prompt and the blank run after it", () => {
    const buf = buffer(["$ git sta"]);
    expect(
      readPromptInput(buf, { line: 0, x: 2 }, { line: 0, x: 9 }, COLS),
    ).toEqual({ typed: "git sta", blankAfter: 11 });
  });

  it("follows soft-wrapped rows", () => {
    const buf = buffer(["$ aaaaaaaaaaaaaaaaaa", "~bbb"]);
    expect(
      readPromptInput(buf, { line: 0, x: 2 }, { line: 1, x: 3 }, COLS)?.typed,
    ).toBe(`${"a".repeat(18)}bbb`);
  });

  it("gives up across a hard line break (continuation prompt)", () => {
    const buf = buffer(['$ echo "a', "> b"]);
    expect(
      readPromptInput(buf, { line: 0, x: 2 }, { line: 1, x: 3 }, COLS),
    ).toBeNull();
  });

  it("counts ink after the cursor (a shell's own suggestion)", () => {
    const buf = buffer(["$ git status --short"]);
    expect(
      readPromptInput(buf, { line: 0, x: 2 }, { line: 0, x: 7 }, COLS)
        ?.blankAfter,
    ).toBe(0);
  });

  it("rejects a cursor before the input start", () => {
    const buf = buffer(["$ ls"]);
    expect(
      readPromptInput(buf, { line: 0, x: 2 }, { line: 0, x: 1 }, COLS),
    ).toBeNull();
    expect(
      readPromptInput(buf, { line: 1, x: 0 }, { line: 0, x: 3 }, COLS),
    ).toBeNull();
  });
});

describe("readFullInput", () => {
  it("joins wrapped rows and trims the tail", () => {
    const buf = buffer(["$ aaaaaaaaaaaaaaaaaa", "~bb   ", "next"]);
    expect(readFullInput(buf, { line: 0, x: 2 })).toBe(`${"a".repeat(18)}bb`);
  });

  it("is null for an empty input", () => {
    expect(readFullInput(buffer(["$   "]), { line: 0, x: 2 })).toBeNull();
  });
});

describe("ghostFor", () => {
  it("returns the remainder of a matching suggestion", () => {
    expect(ghostFor("git st", "git status")).toBe("atus");
  });

  it.each([
    ["", "git status"],
    ["   ", "git status"],
    ["git st", null],
    ["git st", "git st"],
    ["git st", "npm test"],
    ["echo", "echo \u001b[31mred"],
  ])("offers nothing for %j / %j", (typed, suggestion) => {
    expect(ghostFor(typed, suggestion)).toBeNull();
  });
});

describe("fitGhost", () => {
  it("runs to the row edge when nothing follows", () => {
    expect(fitGhost("atus --short", 5, 15, 20)).toBe("atus ");
  });

  it("keeps a gap before a right prompt", () => {
    expect(fitGhost("atus", 3, 5, 20)).toBe("at");
  });

  it("shows nothing without room", () => {
    expect(fitGhost("atus", 1, 5, 20)).toBeNull();
    expect(fitGhost("atus", 0, 19, 20)).toBeNull();
  });
});

describe("isRecordableCommand", () => {
  it("accepts plain commands", () => {
    expect(isRecordableCommand("cargo test -p foo")).toBe(true);
  });

  it.each(["", "   ", " secret-cmd", "a\u0007b"])("rejects %j", (cmd) => {
    expect(isRecordableCommand(cmd)).toBe(false);
  });
});
