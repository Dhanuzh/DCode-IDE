import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  coerceApprovalSettings,
  EDIT_TOOLS,
  effectiveMode,
  isInsideRoot,
  needsApproval,
} from "../lib/approvalPolicy";
import { native } from "../lib/native";
import { resolvePath, type ToolContext } from "./context";

const MAX_ANCESTOR_WALK = 32;

/**
 * Canonical form of a path that may not exist yet: the nearest existing
 * ancestor is canonicalized and the missing tail re-appended.
 */
export async function canonicalizeLenient(
  path: string,
  canonicalize: (p: string) => Promise<string>,
): Promise<string | null> {
  const parts = path.replace(/\\/g, "/").split("/");
  const tail: string[] = [];
  for (let i = 0; i < MAX_ANCESTOR_WALK && parts.length > 0; i++) {
    const joined = parts.join("/") || "/";
    // A bare drive ("C:") resolves to that drive's current directory.
    const candidate = /^[a-zA-Z]:$/.test(joined) ? `${joined}/` : joined;
    try {
      const real = (await canonicalize(candidate)).replace(/\\/g, "/");
      if (tail.length === 0) return real;
      return `${real.replace(/\/+$/, "")}/${tail.join("/")}`;
    } catch {
      const last = parts.pop();
      if (last === undefined) return null;
      if (last !== "") tail.unshift(last);
    }
  }
  return null;
}

/**
 * `needsApproval` for a mutating tool, driven by the user's approval policy.
 * An edit that the policy would auto-run is re-checked against the real
 * filesystem, so a symlink inside the workspace cannot carry an unattended
 * write to a target outside it.
 */
export function approvalGate(ctx: ToolContext, toolName: string) {
  return async (input: unknown): Promise<boolean> => {
    const settings = coerceApprovalSettings(
      usePreferencesStore.getState().aiApprovals,
    );
    const workspaceRoot = ctx.getWorkspaceRoot();
    let resolvedPath: string | null = null;
    if (EDIT_TOOLS.has(toolName)) {
      const raw =
        input && typeof input === "object"
          ? (input as { path?: unknown }).path
          : undefined;
      if (typeof raw === "string") {
        try {
          resolvedPath = resolvePath(raw, ctx.getCwd());
        } catch {
          resolvedPath = null;
        }
      }
    }

    if (
      needsApproval({
        toolName,
        input,
        settings,
        workspaceRoot,
        resolvedPath,
      })
    ) {
      return true;
    }
    if (effectiveMode(settings, workspaceRoot) === "auto-all") return false;
    if (!EDIT_TOOLS.has(toolName)) return false;
    if (!resolvedPath || !workspaceRoot) return true;

    const [realPath, realRoot] = await Promise.all([
      canonicalizeLenient(resolvedPath, native.canonicalize),
      canonicalizeLenient(workspaceRoot, native.canonicalize),
    ]);
    if (!realPath || !realRoot) return true;
    return !isInsideRoot(realPath, realRoot);
  };
}
