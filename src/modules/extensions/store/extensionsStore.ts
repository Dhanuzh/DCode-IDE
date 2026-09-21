import type { Theme } from "@/modules/theme/types";
import { deleteCustomTheme } from "@/modules/theme/customThemes";
import { create } from "zustand";
import {
  applyIconTheme,
  clearIconTheme,
  getActiveIconTheme,
  type ActiveIconTheme,
} from "../lib/iconThemeStore";
import { importThemes } from "../lib/importThemes";
import {
  extNative,
  type ExtSummary,
  type IconThemeContribution,
  type InstalledExt,
  type SearchScope,
} from "../lib/native";
import { themeIdFor } from "../lib/vscodeTheme";

type State = {
  installed: InstalledExt[];
  hydrated: boolean;
  results: ExtSummary[];
  query: string;
  scope: SearchScope;
  searching: boolean;
  error: string | null;
  /** Extension ids with an install or removal in flight. */
  busy: string[];
  /** Themes imported this session, keyed by extension id. */
  importedThemes: Record<string, Theme[]>;
  activeIconTheme: ActiveIconTheme | null;

  hydrate: () => Promise<void>;
  applyIcons: (
    extension: InstalledExt,
    contribution: IconThemeContribution,
    mode: "light" | "dark",
  ) => Promise<void>;
  clearIcons: () => void;
  setQuery: (query: string) => void;
  setScope: (scope: SearchScope) => void;
  search: (query: string) => Promise<void>;
  /** Resolves with the themes the package contributed, in manifest order. */
  install: (summary: ExtSummary) => Promise<Theme[]>;
  remove: (id: string) => Promise<void>;
};

function withoutBusy(busy: string[], id: string): string[] {
  return busy.filter((entry) => entry !== id);
}

export function summaryId(summary: ExtSummary): string {
  return `${summary.namespace}.${summary.name}`;
}

export const useExtensionsStore = create<State>((set, get) => ({
  installed: [],
  hydrated: false,
  results: [],
  query: "",
  scope: "themes",
  searching: false,
  error: null,
  busy: [],
  importedThemes: {},
  activeIconTheme: getActiveIconTheme(),

  hydrate: async () => {
    try {
      const installed = await extNative.list();
      set({ installed, hydrated: true, activeIconTheme: getActiveIconTheme() });
    } catch (error) {
      set({ hydrated: true, error: String(error) });
    }
  },

  applyIcons: async (extension, contribution, mode) => {
    try {
      await applyIconTheme(extension, contribution, mode);
      set({ activeIconTheme: getActiveIconTheme() });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  clearIcons: () => {
    clearIconTheme();
    set({ activeIconTheme: null });
  },

  setQuery: (query) => set({ query }),

  setScope: (scope) => {
    set({ scope });
    void get().search(get().query);
  },

  search: async (query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      set({ results: [], searching: false, error: null });
      return;
    }
    const scope = get().scope;
    set({ searching: true, error: null });
    try {
      const results = await extNative.search(trimmed, scope);
      // A slower earlier search must not overwrite a newer query or scope.
      if (get().query.trim() !== trimmed || get().scope !== scope) return;
      set({ results, searching: false });
    } catch (error) {
      if (get().query.trim() !== trimmed || get().scope !== scope) return;
      set({ searching: false, error: String(error) });
    }
  },

  install: async (summary) => {
    const id = summaryId(summary);
    if (get().busy.includes(id)) return [];
    set((s) => ({ busy: [...s.busy, id], error: null }));
    try {
      const extension = await extNative.install(
        summary.namespace,
        summary.name,
        summary.version,
      );
      const themes = await importThemes(extension);
      set((s) => ({
        installed: [
          ...s.installed.filter((e) => e.id !== extension.id),
          extension,
        ].sort((a, b) => a.displayName.localeCompare(b.displayName)),
        importedThemes: { ...s.importedThemes, [extension.id]: themes },
        busy: withoutBusy(s.busy, id),
      }));
      return themes;
    } catch (error) {
      set((s) => ({ busy: withoutBusy(s.busy, id), error: String(error) }));
      return [];
    }
  },

  remove: async (id) => {
    if (get().busy.includes(id)) return;
    const extension = get().installed.find((e) => e.id === id);
    set((s) => ({ busy: [...s.busy, id], error: null }));
    try {
      await extNative.remove(id);
      if (get().activeIconTheme?.extensionId === id) {
        clearIconTheme();
      }
      // Themes it contributed are copies in the theme store; drop them too.
      for (const contribution of extension?.themes ?? []) {
        await deleteCustomTheme(themeIdFor(id, contribution.label));
      }
      set((s) => {
        const { [id]: _dropped, ...importedThemes } = s.importedThemes;
        return {
          installed: s.installed.filter((e) => e.id !== id),
          importedThemes,
          activeIconTheme: getActiveIconTheme(),
          busy: withoutBusy(s.busy, id),
        };
      });
    } catch (error) {
      set((s) => ({ busy: withoutBusy(s.busy, id), error: String(error) }));
    }
  },
}));
