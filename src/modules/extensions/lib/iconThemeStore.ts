import { EXT_TO_LANGUAGE_ID } from "@/modules/explorer/lib/constants";
import { setIconThemeOverride } from "@/modules/explorer/lib/iconResolver";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  buildIconIndex,
  extensionChain,
  lookupFileIcon,
  lookupFolderIcon,
  type IconThemeDoc,
  type IconThemeIndex,
} from "./iconTheme";
import { parseJsonc } from "./jsonc";
import {
  extNative,
  type IconThemeContribution,
  type InstalledExt,
} from "./native";
import { resolveRelative } from "./paths";

const STORAGE_KEY = "dcode.icon-theme";

export type ActiveIconTheme = { extensionId: string; iconThemeId: string };

let active: ActiveIconTheme | null = null;

export function getActiveIconTheme(): ActiveIconTheme | null {
  return active;
}

function persist(value: ActiveIconTheme | null): void {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage may fail in private mode
  }
}

function readPersisted(): ActiveIconTheme | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveIconTheme>;
    if (
      typeof parsed.extensionId !== "string" ||
      typeof parsed.iconThemeId !== "string"
    ) {
      return null;
    }
    return { extensionId: parsed.extensionId, iconThemeId: parsed.iconThemeId };
  } catch {
    return null;
  }
}

function languageIdFor(name: string): string | null {
  for (const ext of extensionChain(name)) {
    const id = EXT_TO_LANGUAGE_ID[ext];
    if (id) return id;
  }
  return null;
}

function buildOverride(
  index: IconThemeIndex,
  extensionDir: string,
  themePath: string,
) {
  const urlCache = new Map<string, string>();

  const toUrl = (relative: string | null): string | null => {
    if (!relative) return null;
    const cached = urlCache.get(relative);
    if (cached !== undefined) return cached || null;
    const resolved = resolveRelative(themePath, relative);
    if (!resolved) {
      urlCache.set(relative, "");
      return null;
    }
    const separator = /[\\/]$/.test(extensionDir) ? "" : "/";
    const url = convertFileSrc(`${extensionDir}${separator}${resolved}`);
    urlCache.set(relative, url);
    return url;
  };

  return {
    file: (name: string) =>
      toUrl(lookupFileIcon(index, name, languageIdFor(name))),
    folder: (name: string, expanded: boolean, isRoot: boolean) =>
      toUrl(lookupFolderIcon(index, name, expanded, isRoot)),
  };
}

export async function applyIconTheme(
  extension: InstalledExt,
  contribution: IconThemeContribution,
  mode: "light" | "dark",
): Promise<void> {
  const raw = await extNative.readText(extension.id, contribution.path);
  const doc = parseJsonc<IconThemeDoc>(raw);
  const index = buildIconIndex(doc, mode);
  setIconThemeOverride(buildOverride(index, extension.dir, contribution.path));
  active = { extensionId: extension.id, iconThemeId: contribution.id };
  persist(active);
}

export function clearIconTheme(): void {
  setIconThemeOverride(null);
  active = null;
  persist(null);
}

/**
 * Re-applies the icon theme chosen in a previous session. Silently gives up if
 * the extension was removed outside the app.
 */
export async function restoreIconTheme(mode: "light" | "dark"): Promise<void> {
  const saved = readPersisted();
  if (!saved) return;
  try {
    const installed = await extNative.list();
    const extension = installed.find((e) => e.id === saved.extensionId);
    const contribution = extension?.iconThemes.find(
      (t) => t.id === saved.iconThemeId,
    );
    if (!extension || !contribution) {
      persist(null);
      return;
    }
    await applyIconTheme(extension, contribution, mode);
  } catch {
    persist(null);
  }
}
