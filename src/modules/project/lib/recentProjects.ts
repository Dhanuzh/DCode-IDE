import { baseName, normalizePath } from "./paths";

export type RecentProject = { path: string; name: string; at: number };

export const MAX_RECENT_PROJECTS = 15;
const STORAGE_KEY = "dcode.recent-projects";

export function parseRecents(raw: string | null): RecentProject[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const { path, name, at } = entry as Partial<RecentProject>;
      if (typeof path !== "string" || !path) return [];
      return [
        {
          path,
          name: typeof name === "string" && name ? name : baseName(path),
          at: typeof at === "number" ? at : 0,
        },
      ];
    });
  } catch {
    return [];
  }
}

/** Most recent first, one entry per path, capped. */
export function pushRecent(
  recents: RecentProject[],
  path: string,
  now = Date.now(),
): RecentProject[] {
  const normalized = normalizePath(path);
  const entry: RecentProject = {
    path: normalized,
    name: baseName(normalized),
    at: now,
  };
  return [
    entry,
    ...recents.filter((r) => normalizePath(r.path) !== normalized),
  ].slice(0, MAX_RECENT_PROJECTS);
}

export function readRecentProjects(): RecentProject[] {
  try {
    return parseRecents(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function writeRecentProjects(recents: RecentProject[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recents));
  } catch {
    // storage may fail in private mode
  }
}

export function rememberProject(path: string): RecentProject[] {
  const next = pushRecent(readRecentProjects(), path);
  writeRecentProjects(next);
  return next;
}

export function forgetProject(path: string): RecentProject[] {
  const normalized = normalizePath(path);
  const next = readRecentProjects().filter(
    (r) => normalizePath(r.path) !== normalized,
  );
  writeRecentProjects(next);
  return next;
}
