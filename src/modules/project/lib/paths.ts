/** Path helpers for the project picker. Forward slash is the canonical form. */

export function normalizePath(path: string): string {
  const slashed = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  return slashed.length > 1 ? slashed.replace(/\/+$/, "") : slashed;
}

export function baseName(path: string): string {
  const parts = normalizePath(path).split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : normalizePath(path);
}

/** Parent directory, or null at a filesystem root. */
export function parentDir(path: string): string | null {
  const normalized = normalizePath(path);
  if (normalized === "/" || /^[a-zA-Z]:$/.test(normalized)) return null;
  const cut = normalized.lastIndexOf("/");
  if (cut < 0) return null;
  if (cut === 0) return "/";
  const parent = normalized.slice(0, cut);
  return /^[a-zA-Z]:$/.test(parent) ? `${parent}/` : parent;
}
