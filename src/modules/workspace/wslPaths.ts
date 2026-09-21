/** Forward slashes, no trailing one. */
function normalizePath(path: string): string {
  const slashed = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  return slashed.length > 1 ? slashed.replace(/\/+$/, "") : slashed;
}

/**
 * The OS folder dialog is a Windows dialog, so in a WSL workspace it hands
 * back Windows paths: `\\wsl.localhost\<distro>\home\u\proj` for the distro's
 * own filesystem, or `C:\...` for a drive that WSL sees under `/mnt`. These
 * translate both ways so a picked folder is usable as the workspace root.
 */

const UNC_PREFIX_RE = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\?(.*)$/i;

/** WSL path -> a path the Windows dialog can open. */
export function wslToWindows(path: string, distro: string): string {
  const normalized = normalizePath(path);
  const drive = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(normalized);
  if (drive) {
    const rest = (drive[2] ?? "").replace(/\//g, "\\");
    return `${drive[1].toUpperCase()}:${rest || "\\"}`;
  }
  const trimmed = normalized.replace(/^\/+/, "").replace(/\//g, "\\");
  return `\\\\wsl.localhost\\${distro}\\${trimmed}`;
}

/**
 * Windows path -> WSL path. Returns null when the path belongs to another
 * distro, which cannot be a root for this workspace.
 */
export function windowsToWsl(path: string, distro: string): string | null {
  const unc = UNC_PREFIX_RE.exec(path.trim());
  if (unc) {
    if (unc[1].toLowerCase() !== distro.toLowerCase()) return null;
    const rest = unc[2].replace(/\\/g, "/").replace(/^\/+/, "");
    return `/${rest}`.replace(/\/+$/, "") || "/";
  }
  const drive = /^([a-zA-Z]):[\\/]?(.*)$/.exec(path.trim());
  if (drive) {
    const rest = drive[2].replace(/\\/g, "/").replace(/\/+$/, "");
    const base = `/mnt/${drive[1].toLowerCase()}`;
    return rest ? `${base}/${rest}` : base;
  }
  // Already a Unix path (some pickers hand one back).
  return path.startsWith("/") ? normalizePath(path) : null;
}
