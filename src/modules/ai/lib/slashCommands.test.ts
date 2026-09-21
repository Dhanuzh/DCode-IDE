import { describe, expect, it, vi } from "vitest";

const newSession = vi.hoisted(() => vi.fn());
const plan = vi.hoisted(() => ({ active: false }));

vi.mock("../store/chatStore", () => ({
  useChatStore: { getState: () => ({ newSession }) },
}));
vi.mock("../store/planStore", () => ({
  usePlanStore: {
    getState: () => ({
      active: plan.active,
      toggle: () => {
        plan.active = !plan.active;
      },
      disable: () => {
        plan.active = false;
      },
    }),
  },
}));

import type { CustomCommand } from "./customCommands";
import {
  allCommandMetas,
  parseDelegateArgs,
  findCommandMeta,
  RESERVED_COMMAND_NAMES,
  DCODE_CMD_RE,
  tryRunSlashCommand,
} from "./slashCommands";

const custom: CustomCommand[] = [
  {
    name: "git:pr",
    description: "Open a PR",
    argumentHint: "<title>",
    body: "Open a PR titled $1 with $ARGUMENTS",
    source: "project",
    path: "/w/.dcode/commands/git/pr.md",
  },
];

describe("tryRunSlashCommand", () => {
  it("ignores plain text and unknown commands", () => {
    expect(tryRunSlashCommand("hello")).toEqual({ kind: "none" });
    expect(tryRunSlashCommand("/nope x")).toEqual({ kind: "none" });
    expect(tryRunSlashCommand("#snippet-handle")).toEqual({ kind: "none" });
  });

  it("expands prompt built-ins with their arguments", () => {
    const out = tryRunSlashCommand("/review error handling");
    expect(out.kind).toBe("send-prompt");
    if (out.kind !== "send-prompt") return;
    expect(out.commandName).toBe("review");
    expect(out.prompt).toContain("focusing on: error handling");
  });

  it("keeps multi-line arguments intact", () => {
    const out = tryRunSlashCommand("/explain line one\nline two");
    expect(out.kind === "send-prompt" && out.prompt).toContain(
      "line one\nline two",
    );
  });

  it("runs handled built-ins without sending", () => {
    expect(tryRunSlashCommand("/clear")).toEqual({ kind: "handled" });
    expect(newSession).toHaveBeenCalledTimes(1);
    expect(tryRunSlashCommand("/plan")).toEqual({
      kind: "handled",
      toast: "Plan mode on",
    });
    expect(tryRunSlashCommand("/plan off")).toEqual({
      kind: "handled",
      toast: "Plan mode off",
    });
    expect(tryRunSlashCommand("/claude-code")).toEqual({
      kind: "handled",
      toast: "Usage: /claude-code <request>",
    });
  });

  it("dispatches custom commands through their template", () => {
    expect(tryRunSlashCommand('/git:pr "Fix login" now', custom)).toEqual({
      kind: "send-prompt",
      prompt: 'Open a PR titled Fix login with "Fix login" now',
      commandName: "git:pr",
    });
    expect(tryRunSlashCommand("#git:pr x", custom).kind).toBe("send-prompt");
  });

  it("is case-insensitive on the command name", () => {
    expect(tryRunSlashCommand("/REVIEW").kind).toBe("send-prompt");
  });
});

describe("parseDelegateArgs", () => {
  it("picks a named managed agent", () => {
    expect(parseDelegateArgs("Codex fix the flaky test")).toEqual({
      agent: "codex",
      request: "fix the flaky test",
    });
  });

  it("defaults to claude when no agent is named", () => {
    expect(parseDelegateArgs("fix the flaky test")).toEqual({
      agent: "claude",
      request: "fix the flaky test",
    });
    expect(parseDelegateArgs("opencode do x").agent).toBe("claude");
  });

  it("routes the directive to the chosen agent", () => {
    const out = tryRunSlashCommand("/delegate gemini write docs");
    expect(out.kind === "send-prompt" && out.prompt).toContain(
      'agent "gemini"',
    );
    expect(tryRunSlashCommand("/delegate")).toEqual({
      kind: "handled",
      toast: "Usage: /delegate [agent] <request>",
    });
  });
});

describe("command metadata", () => {
  it("lists built-ins before custom commands", () => {
    const metas = allCommandMetas(custom);
    expect(metas[0].source).toBe("builtin");
    expect(metas[metas.length - 1]).toMatchObject({
      name: "git:pr",
      source: "project",
    });
  });

  it("finds metadata for both kinds", () => {
    expect(findCommandMeta("review", [])?.label).toBe("Review changes");
    expect(findCommandMeta("git:pr", custom)?.description).toBe("Open a PR");
    expect(findCommandMeta("zzz", custom)).toBeUndefined();
  });

  it("reserves every built-in name", () => {
    for (const name of ["init", "plan", "review", "fix", "clear"]) {
      expect(RESERVED_COMMAND_NAMES.has(name)).toBe(true);
    }
  });

  it("recognizes namespaced command markers", () => {
    expect(
      '<dcode-command name="git:pr" />\n\nx'.match(DCODE_CMD_RE)?.[1],
    ).toBe("git:pr");
  });
});
