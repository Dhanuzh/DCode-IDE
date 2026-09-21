import type { UIMessage } from "@ai-sdk/react";
import { describe, expect, it } from "vitest";
import type { SessionMeta } from "./sessions";
import { compactTranscript, pruneSessions } from "./transcript";

function toolMessage(
  state: string,
  input: unknown,
  output?: unknown,
): UIMessage {
  return {
    id: "m1",
    role: "assistant",
    parts: [
      {
        type: "tool-read_file",
        toolCallId: "c1",
        state,
        input,
        output,
      },
    ],
  } as unknown as UIMessage;
}

function toolPart(messages: UIMessage[]) {
  return messages[0].parts[0] as unknown as { input: unknown; output: unknown };
}

describe("compactTranscript", () => {
  it("trims long strings in settled tool outputs and inputs", () => {
    const long = "x".repeat(100);
    const out = compactTranscript(
      [toolMessage("output-available", { content: long }, { text: long })],
      10,
    );
    const part = toolPart(out);
    expect((part.output as { text: string }).text).toMatch(
      /^x{10}\n\.\.\.\[90 characters trimmed when saved\]$/,
    );
    expect(
      (part.input as { content: string }).content.startsWith("x".repeat(10)),
    ).toBe(true);
  });

  it("never trims a call still awaiting approval", () => {
    const long = "x".repeat(100);
    const messages = [toolMessage("approval-requested", { content: long })];
    expect(compactTranscript(messages, 10)).toBe(messages);
  });

  it("keeps identity when nothing needs trimming", () => {
    const messages = [
      toolMessage("output-available", { path: "a" }, "short"),
      {
        id: "u",
        role: "user",
        parts: [{ type: "text", text: "y".repeat(100) }],
      } as UIMessage,
    ];
    expect(compactTranscript(messages, 10)).toBe(messages);
  });

  it("leaves text parts alone even when long", () => {
    const messages = [
      {
        id: "a",
        role: "assistant",
        parts: [{ type: "text", text: "y".repeat(100) }],
      } as UIMessage,
    ];
    expect(compactTranscript(messages, 10)).toBe(messages);
  });

  it("trims strings nested in arrays", () => {
    const out = compactTranscript(
      [toolMessage("output-available", {}, { lines: ["z".repeat(50)] })],
      5,
    );
    const lines = (toolPart(out).output as { lines: string[] }).lines;
    expect(lines[0].startsWith("zzzzz\n...[45")).toBe(true);
  });
});

function meta(id: string, updatedAt: number): SessionMeta {
  return { id, title: id, createdAt: 0, updatedAt };
}

describe("pruneSessions", () => {
  it("keeps everything under the cap", () => {
    const sessions = [meta("a", 1), meta("b", 2)];
    expect(pruneSessions(sessions, "a", 5)).toEqual({
      keep: sessions,
      drop: [],
    });
  });

  it("drops the least recently active past the cap, preserving order", () => {
    const sessions = [meta("a", 3), meta("b", 1), meta("c", 2)];
    const { keep, drop } = pruneSessions(sessions, null, 2);
    expect(keep.map((s) => s.id)).toEqual(["a", "c"]);
    expect(drop.map((s) => s.id)).toEqual(["b"]);
  });

  it("always keeps the active session", () => {
    const sessions = [meta("a", 3), meta("b", 1), meta("c", 2)];
    const { keep, drop } = pruneSessions(sessions, "b", 2);
    expect(keep.map((s) => s.id)).toEqual(["a", "b"]);
    expect(drop.map((s) => s.id)).toEqual(["c"]);
  });
});
