import {
  currentWorkspaceEnv,
  windowsToWsl,
  wslToWindows,
} from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { normalizePath } from "./paths";

/**
 * The OS file/folder dialog. The dialog plugin's command is invoked directly
 * so the app does not carry its JS wrapper, and paths are translated for a WSL
 * workspace, whose filesystem a Windows dialog only reaches over the
 * `\\wsl.localhost` share.
 */

type OpenOptions = {
  directory?: boolean;
  multiple?: boolean;
  defaultPath?: string;
  title?: string;
};

/** The plugin returns a bare path, an object carrying one, or null. */
function firstPath(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) return firstPath(result[0]);
  if (result && typeof result === "object") {
    const path = (result as { path?: unknown }).path;
    if (typeof path === "string") return path;
  }
  return null;
}

async function openNative(options: OpenOptions): Promise<string | null> {
  const result = await invoke<unknown>("plugin:dialog|open", { options });
  return firstPath(result);
}

export type PickResult =
  | { ok: true; path: string }
  | { ok: false; reason: string }
  | null;

async function pick(
  options: OpenOptions,
  startPath: string | null,
): Promise<PickResult> {
  const env = currentWorkspaceEnv();
  const wsl = env.kind === "wsl" ? env.distro : null;
  const defaultPath =
    startPath && wsl ? wslToWindows(startPath, wsl) : (startPath ?? undefined);

  const picked = await openNative({ ...options, defaultPath });
  if (!picked) return null;
  if (!wsl) return { ok: true, path: normalizePath(picked) };

  const translated = windowsToWsl(picked, wsl);
  if (!translated) {
    return {
      ok: false,
      reason: `That path is outside the ${wsl} workspace. Pick a folder inside it, or switch the workspace first.`,
    };
  }
  return { ok: true, path: translated };
}

export function pickFolder(startPath: string | null): Promise<PickResult> {
  return pick(
    { directory: true, multiple: false, title: "Open folder" },
    startPath,
  );
}

export function pickFile(startPath: string | null): Promise<PickResult> {
  return pick(
    { directory: false, multiple: false, title: "Open file" },
    startPath,
  );
}
