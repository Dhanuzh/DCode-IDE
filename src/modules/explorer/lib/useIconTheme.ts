import { useSyncExternalStore } from "react";
import { getIconThemeVersion, subscribeIconTheme } from "./iconResolver";

/**
 * Re-renders a component that draws file icons when the active icon theme
 * changes. `fileIconUrl`/`folderIconUrl` are plain functions, so nothing else
 * would tell React their result is stale.
 */
export function useIconThemeVersion(): number {
  return useSyncExternalStore(
    subscribeIconTheme,
    getIconThemeVersion,
    getIconThemeVersion,
  );
}
