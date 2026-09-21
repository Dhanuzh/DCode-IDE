import { describe, expect, it } from "vitest";
import { parseJsonc, stripJsonc } from "./jsonc";

describe("stripJsonc", () => {
  it("removes line and block comments", () => {
    const raw = `{
      // a line comment
      "a": 1, /* inline */
      /* multi
         line */
      "b": 2
    }`;
    expect(parseJsonc(raw)).toEqual({ a: 1, b: 2 });
  });

  it("removes trailing commas in objects and arrays", () => {
    expect(parseJsonc('{ "a": [1, 2, 3, ], }')).toEqual({ a: [1, 2, 3] });
  });

  it("keeps comment-like sequences inside strings", () => {
    expect(
      parseJsonc('{ "url": "https://x.dev//p", "c": "/* not a comment */" }'),
    ).toEqual({
      url: "https://x.dev//p",
      c: "/* not a comment */",
    });
  });

  it("keeps escaped quotes inside strings", () => {
    expect(parseJsonc('{ "a": "say \\"hi\\" // ok" }')).toEqual({
      a: 'say "hi" // ok',
    });
  });

  it("leaves plain JSON untouched", () => {
    expect(stripJsonc('{"a":1}')).toBe('{"a":1}');
  });
});
