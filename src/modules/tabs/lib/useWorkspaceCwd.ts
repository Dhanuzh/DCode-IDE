import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Tab } from "./useTabs";
import {
  resolveExplorerRoot,
  resolveNewTabCwd,
  type RootInput,
} from "./workspaceRoot";

type Result = {
  explorerRoot: string | null;
  inheritedCwdForNewTab: () => string | undefined;
};

export function useWorkspaceCwd(
  activeTab: Tab | undefined,
  tabs: Tab[],
  home: string | null,
  /** Root of the open project, when the space has one. */
  projectRoot: string | null = null,
): Result {
  const lastTerminalCwd = useRef<string | null>(null);

  useEffect(() => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) {
      lastTerminalCwd.current = activeTab.cwd;
    }
  }, [activeTab]);

  const rootInput = useCallback((): RootInput => {
    const anyTerm = tabs.find((t) => t.kind === "terminal" && t.cwd);
    return {
      projectRoot,
      activeTerminalCwd:
        activeTab?.kind === "terminal" ? (activeTab.cwd ?? null) : null,
      lastTerminalCwd: lastTerminalCwd.current,
      anyTerminalCwd:
        anyTerm?.kind === "terminal" ? (anyTerm.cwd ?? null) : null,
      home,
    };
  }, [activeTab, tabs, home, projectRoot]);

  const explorerRoot = useMemo<string | null>(
    () => resolveExplorerRoot(rootInput()),
    [rootInput],
  );

  // Editor tabs inherit the terminal's cwd (or the project root), not the
  // file's folder - opening a terminal from a file shouldn't hijack the
  // working directory.
  const inheritedCwdForNewTab = useCallback(
    (): string | undefined => resolveNewTabCwd(rootInput()),
    [rootInput],
  );

  return { explorerRoot, inheritedCwdForNewTab };
}
