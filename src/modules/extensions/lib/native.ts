import { invoke } from "@tauri-apps/api/core";

export type ExtSummary = {
  namespace: string;
  name: string;
  version: string;
  displayName: string;
  description: string;
  downloadCount: number;
  averageRating: number | null;
  iconUrl: string | null;
};

export type ThemeContribution = {
  label: string;
  uiTheme: string;
  path: string;
};

export type IconThemeContribution = {
  id: string;
  label: string;
  path: string;
};

export type InstalledExt = {
  id: string;
  dir: string;
  iconPath: string | null;
  name: string;
  publisher: string;
  version: string;
  displayName: string;
  description: string;
  icon: string | null;
  main: string | null;
  themes: ThemeContribution[];
  iconThemes: IconThemeContribution[];
  grammarCount: number;
  snippetCount: number;
  hasCode: boolean;
};

/** Open VSX categories DCode-IDE can actually apply. */
export type SearchScope = "themes" | "all";

export const extNative = {
  search: (query: string, scope: SearchScope, size = 24) =>
    invoke<ExtSummary[]>("ext_search", {
      query,
      size,
      category: scope === "themes" ? "Themes" : null,
    }),
  install: (namespace: string, name: string, version?: string) =>
    invoke<InstalledExt>("ext_install", {
      namespace,
      name,
      version: version ?? null,
    }),
  list: () => invoke<InstalledExt[]>("ext_list"),
  remove: (id: string) => invoke<void>("ext_remove", { id }),
  readText: (id: string, path: string) =>
    invoke<string>("ext_read_text", { id, path }),
};
