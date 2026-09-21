import { saveCustomTheme } from "@/modules/theme/customThemes";
import type { Theme } from "@/modules/theme/types";
import { validateTheme } from "@/modules/theme/validateTheme";
import { parseJsonc } from "./jsonc";
import { extNative, type InstalledExt, type ThemeContribution } from "./native";
import { resolveRelative } from "./paths";
import {
  convertVsCodeTheme,
  mergePalettes,
  normalizePalette,
  type VsCodeThemeFile,
} from "./vscodeTheme";

// VS Code themes may chain `include`; a real one is 1-2 deep.
const MAX_INCLUDE_DEPTH = 4;

type LoadedTheme = { file: VsCodeThemeFile; palette: Record<string, string> };

async function loadThemeFile(
  extensionId: string,
  path: string,
  depth = 0,
): Promise<LoadedTheme> {
  const raw = await extNative.readText(extensionId, path);
  const file = parseJsonc<VsCodeThemeFile>(raw);
  const own = normalizePalette(file.colors);
  if (!file.include || depth >= MAX_INCLUDE_DEPTH)
    return { file, palette: own };

  const basePath = resolveRelative(path, file.include);
  if (!basePath) return { file, palette: own };
  try {
    const base = await loadThemeFile(extensionId, basePath, depth + 1);
    return { file, palette: mergePalettes(base.palette, own) };
  } catch {
    return { file, palette: own };
  }
}

export async function importTheme(
  extension: InstalledExt,
  contribution: ThemeContribution,
): Promise<Theme> {
  const { file, palette } = await loadThemeFile(
    extension.id,
    contribution.path,
  );
  const converted = convertVsCodeTheme({
    extensionId: extension.id,
    label: contribution.label,
    uiTheme: contribution.uiTheme,
    publisher: extension.publisher,
    file,
    palette,
  });
  const result = validateTheme(converted);
  if (!result.ok) throw new Error(result.error);
  await saveCustomTheme(result.theme);
  return result.theme;
}

/** Imports every theme an extension contributes; returns what converted cleanly. */
export async function importThemes(extension: InstalledExt): Promise<Theme[]> {
  const out: Theme[] = [];
  for (const contribution of extension.themes) {
    try {
      out.push(await importTheme(extension, contribution));
    } catch {
      // A single unreadable theme file must not fail the whole extension.
    }
  }
  return out;
}
