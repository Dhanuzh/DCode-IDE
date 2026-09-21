import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalSettings } from "../lib/approvalPolicy";
import type { ToolContext } from "./context";

const state = vi.hoisted(() => ({
  aiApprovals: { mode: "ask", projects: {} } as ApprovalSettings,
  // Maps a path to what the filesystem resolves it to; absent = missing.
  real: new Map<string, string>(),
}));

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: { getState: () => ({ aiApprovals: state.aiApprovals }) },
}));
vi.mock("../lib/native", () => ({
  native: {
    canonicalize: async (p: string) => {
      const hit = state.real.get(p);
      if (hit === undefined) throw new Error("ENOENT");
      return hit;
    },
  },
}));

import { approvalGate, canonicalizeLenient } from "./approval";

const ROOT = "/w/proj";

function ctx(): ToolContext {
  return {
    getCwd: () => ROOT,
    getWorkspaceRoot: () => ROOT,
  } as unknown as ToolContext;
}

beforeEach(() => {
  state.aiApprovals = { mode: "auto-edits", projects: {} };
  state.real = new Map([
    [ROOT, ROOT],
    [`${ROOT}/src`, `${ROOT}/src`],
    [`${ROOT}/src/a.ts`, `${ROOT}/src/a.ts`],
    [`${ROOT}/link`, "/home/u/.config"],
    ["/", "/"],
  ]);
});

describe("canonicalizeLenient", () => {
  const canon = async (p: string) => {
    const hit = state.real.get(p);
    if (hit === undefined) throw new Error("ENOENT");
    return hit;
  };

  it("returns the real path of an existing file", async () => {
    expect(await canonicalizeLenient(`${ROOT}/src/a.ts`, canon)).toBe(
      `${ROOT}/src/a.ts`,
    );
  });

  it("re-appends missing segments to the nearest real ancestor", async () => {
    expect(await canonicalizeLenient(`${ROOT}/src/new/b.ts`, canon)).toBe(
      `${ROOT}/src/new/b.ts`,
    );
  });

  it("follows a symlinked ancestor", async () => {
    expect(await canonicalizeLenient(`${ROOT}/link/x/y`, canon)).toBe(
      "/home/u/.config/x/y",
    );
  });
});

describe("approvalGate", () => {
  it("auto-runs an edit that really lands inside the workspace", async () => {
    const gate = approvalGate(ctx(), "edit");
    expect(await gate({ path: "src/a.ts" })).toBe(false);
    expect(await gate({ path: "src/new/file.ts" })).toBe(false);
  });

  it("asks when a symlink inside the workspace points outside it", async () => {
    const gate = approvalGate(ctx(), "write_file");
    expect(await gate({ path: "link/fish/config.fish" })).toBe(true);
  });

  it("asks for edits outside the workspace", async () => {
    const gate = approvalGate(ctx(), "edit");
    expect(await gate({ path: "/etc/hosts" })).toBe(true);
  });

  it("asks for shell commands under auto-edits", async () => {
    const gate = approvalGate(ctx(), "bash_run");
    expect(await gate({ command: "pnpm test" })).toBe(true);
  });

  it("asks for everything in ask mode", async () => {
    state.aiApprovals = { mode: "ask", projects: {} };
    const gate = approvalGate(ctx(), "edit");
    expect(await gate({ path: "src/a.ts" })).toBe(true);
  });

  it("treats a malformed stored policy as ask", async () => {
    state.aiApprovals = { mode: "yolo" } as unknown as ApprovalSettings;
    const gate = approvalGate(ctx(), "edit");
    expect(await gate({ path: "src/a.ts" })).toBe(true);
  });

  it("auto-all skips the filesystem re-check entirely", async () => {
    state.aiApprovals = { mode: "auto-all", projects: {} };
    const gate = approvalGate(ctx(), "write_file");
    expect(await gate({ path: "link/x" })).toBe(false);
  });
});
