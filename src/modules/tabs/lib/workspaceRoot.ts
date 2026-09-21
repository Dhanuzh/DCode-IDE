/**
 * Where the workspace is rooted. A space with an explicit project root (opened
 * through Open Folder) pins the explorer, the AI's workspace root and the cwd
 * of new terminals; without one the app keeps following the focused terminal,
 * which is the terminal-first default.
 */
export type RootInput = {
  projectRoot: string | null;
  activeTerminalCwd: string | null;
  lastTerminalCwd: string | null;
  anyTerminalCwd: string | null;
  home: string | null;
};

export function resolveExplorerRoot(input: RootInput): string | null {
  return (
    input.projectRoot ??
    input.activeTerminalCwd ??
    input.lastTerminalCwd ??
    input.anyTerminalCwd ??
    input.home
  );
}

/** cwd a newly opened terminal starts in. */
export function resolveNewTabCwd(input: RootInput): string | undefined {
  // Inside a project, a new terminal starts at its root unless the focused
  // terminal already sits somewhere in it.
  if (input.projectRoot) {
    const cwd = input.activeTerminalCwd;
    return cwd && isInside(cwd, input.projectRoot) ? cwd : input.projectRoot;
  }
  return (
    input.activeTerminalCwd ?? input.lastTerminalCwd ?? input.home ?? undefined
  );
}

function normalize(path: string): string {
  const slashed = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  const trimmed = slashed.length > 1 ? slashed.replace(/\/+$/, "") : slashed;
  return /^[a-zA-Z]:/.test(trimmed) ? trimmed.toLowerCase() : trimmed;
}

export function isInside(path: string, root: string): boolean {
  const p = normalize(path);
  const r = normalize(root);
  return p === r || p.startsWith(r.endsWith("/") ? r : `${r}/`);
}
