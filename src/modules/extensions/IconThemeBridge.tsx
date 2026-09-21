import { useTheme } from "@/modules/theme";
import { useEffect } from "react";
import { restoreIconTheme } from "./lib/iconThemeStore";

/**
 * Re-applies the installed icon theme on startup, and again when the app flips
 * light/dark so a theme's `light` icon overrides take effect.
 */
export function IconThemeBridge() {
  const { resolvedMode } = useTheme();
  useEffect(() => {
    void restoreIconTheme(resolvedMode);
  }, [resolvedMode]);
  return null;
}
