import { describe, expect, it } from "vitest";
import {
  buildSshCommand,
  formatSshTarget,
  parseSshTarget,
  pushRecent,
} from "./target";

describe("parseSshTarget", () => {
  it.each([
    ["prod", { user: null, host: "prod", port: null }],
    ["deploy@10.0.0.5", { user: "deploy", host: "10.0.0.5", port: null }],
    [
      "me@box.example.com:2222",
      { user: "me", host: "box.example.com", port: 2222 },
    ],
    ["ssh://me@box:22/", { user: "me", host: "box", port: 22 }],
    ["[::1]:2200", { user: null, host: "[::1]", port: 2200 }],
    ["  git@github.com  ", { user: "git", host: "github.com", port: null }],
  ])("parses %j", (input, expected) => {
    expect(parseSshTarget(input)).toEqual(expected);
  });

  it.each([
    "",
    "-oProxyCommand=calc",
    "me@-oProxyCommand=x",
    "-me@host",
    "host; rm -rf ~",
    "host $(whoami)",
    "host`id`",
    "host:0",
    "host:65536",
    "host:22x",
    "two words",
    "user@",
    "[::1",
    "[::1]x",
    ".hidden",
  ])("rejects %j", (input) => {
    expect(parseSshTarget(input)).toBeNull();
  });
});

describe("formatting and commands", () => {
  it("omits the default port", () => {
    const t = { user: "me", host: "box", port: 22 };
    expect(formatSshTarget(t)).toBe("me@box");
    expect(buildSshCommand(t)).toBe("ssh me@box");
  });

  it("passes a custom port with -p", () => {
    const t = { user: null, host: "box", port: 2222 };
    expect(formatSshTarget(t)).toBe("box:2222");
    expect(buildSshCommand(t)).toBe("ssh -p 2222 box");
  });

  it("unwraps IPv6 brackets for the command", () => {
    expect(buildSshCommand({ user: "me", host: "[::1]", port: null })).toBe(
      "ssh me@::1",
    );
  });
});

describe("pushRecent", () => {
  it("moves a repeat to the front and caps the list", () => {
    const many = Array.from({ length: 12 }, (_, i) => `h${i}`);
    const next = pushRecent(many, "h5");
    expect(next[0]).toBe("h5");
    expect(next).toHaveLength(12);
    expect(pushRecent(many, "new")).toHaveLength(12);
    expect(pushRecent(many, "new")[11]).toBe("h10");
  });
});
