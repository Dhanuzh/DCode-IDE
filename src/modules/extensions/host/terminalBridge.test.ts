import { describe, expect, it } from "vitest";
import {
  extTerminalBridge,
  sanitizeTerminalText,
  setExtTerminalBridge,
} from "./terminalBridge";

describe("sanitizeTerminalText", () => {
  it("accepts ordinary command text", () => {
    expect(sanitizeTerminalText("pnpm test --run")).toBe("pnpm test --run");
  });

  it("refuses control bytes, including a smuggled newline", () => {
    expect(sanitizeTerminalText("pnpm test\rrm -rf ~")).toBeNull();
    expect(sanitizeTerminalText("pnpm test\nrm -rf ~")).toBeNull();
    expect(sanitizeTerminalText("a\u0007b")).toBeNull();
  });

  it("refuses empty and oversized text", () => {
    expect(sanitizeTerminalText("")).toBeNull();
    expect(sanitizeTerminalText("x".repeat(8193))).toBeNull();
  });
});

describe("the bridge registry", () => {
  it("hands back what was registered, and clears", () => {
    const bridge = {
      create: () => {},
      sendText: () => {},
      show: () => {},
      dispose: () => {},
    };
    setExtTerminalBridge(bridge);
    expect(extTerminalBridge()).toBe(bridge);
    setExtTerminalBridge(null);
    expect(extTerminalBridge()).toBeNull();
  });
});

describe("secretAccount", () => {
  it("namespaces a secret by extension", async () => {
    const { secretAccount } = await import("./extHostStore");
    expect(secretAccount("anthropic.claude-code", "token")).toBe(
      "anthropic.claude-code:token",
    );
  });

  it("refuses a secret with no running extension or a bad key", async () => {
    const { secretAccount } = await import("./extHostStore");
    expect(secretAccount(null, "token")).toBeNull();
    expect(secretAccount("ext", "")).toBeNull();
    expect(secretAccount("ext", 3)).toBeNull();
    expect(secretAccount("ext", "a\u0000b")).toBeNull();
    expect(secretAccount("ext", "x".repeat(129))).toBeNull();
  });
});
