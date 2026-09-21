import { leafIds } from "@/modules/terminal/lib/panes";
import { isPanelTab } from "./editorArea";
import type {
  EditorTab,
  GitDiffOpenInput,
  GitDiffTab,
  GitHistoryTab,
  Tab,
  TerminalTab,
} from "./tabTypes";

export function planFileTabOpen(
  tabs: Tab[],
  path: string,
  pin: boolean,
  spaceId: string,
  allocId: () => number,
): { tabs: Tab[]; tabId: number } {
  if (pin) {
    const existing = tabs.find(
      (tab) =>
        tab.kind === "editor" && tab.spaceId === spaceId && tab.path === path,
    );
    if (existing?.kind === "editor") {
      return {
        tabs: existing.preview
          ? tabs.map((tab) =>
              tab.id === existing.id ? { ...tab, preview: false } : tab,
            )
          : tabs,
        tabId: existing.id,
      };
    }

    const tabId = allocId();
    return {
      tabs: [
        ...tabs,
        {
          id: tabId,
          kind: "editor",
          spaceId,
          title: basename(path),
          path,
          dirty: false,
          preview: false,
        },
      ],
      tabId,
    };
  }

  const persistent = tabs.find(
    (tab) =>
      tab.kind === "editor" &&
      tab.spaceId === spaceId &&
      tab.path === path &&
      !tab.preview,
  );
  if (persistent) return { tabs, tabId: persistent.id };

  const existingPreview = tabs.find(
    (tab) =>
      tab.kind === "editor" &&
      tab.spaceId === spaceId &&
      tab.path === path &&
      tab.preview,
  );
  if (existingPreview) return { tabs, tabId: existingPreview.id };

  const previewIndex = tabs.findIndex(
    (tab) => tab.kind === "editor" && tab.spaceId === spaceId && tab.preview,
  );
  const tabId = allocId();
  const tab: EditorTab = {
    id: tabId,
    kind: "editor",
    spaceId,
    title: basename(path),
    path,
    dirty: false,
    preview: true,
  };
  if (previewIndex === -1) return { tabs: [...tabs, tab], tabId };

  const next = [...tabs];
  next[previewIndex] = tab;
  return { tabs: next, tabId };
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host || url;
  } catch {
    return url || "preview";
  }
}


// Returns the tab at position `idx` within the given space, or undefined when
// idx is out of range or no matching space tab exists.
export function pickTabBySpaceIndex(
  tabs: Tab[],
  idx: number,
  spaceId: string,
): Tab | undefined {
  const pool = tabs.filter((t) => t.spaceId === spaceId);
  return pool[idx];
}

// Next active after close, scoped to the closing tab's space. null = last tab of
// its space, which callers treat as "refuse to close". Prefers a neighbour in
// the same region (editor area or terminal panel) so closing an editor keeps an
// editor on screen instead of jumping focus into the panel.
export function nextActiveInSpace(
  tabs: Tab[],
  closingId: number,
): number | null {
  const closing = tabs.find((t) => t.id === closingId);
  if (!closing) return null;
  const sameSpace = tabs.filter((t) => t.spaceId === closing.spaceId);
  if (sameSpace.length <= 1) return null;
  const sameRegion = sameSpace.filter(
    (t) => isPanelTab(t) === isPanelTab(closing),
  );
  const pool = sameRegion.length > 1 ? sameRegion : sameSpace;
  const idx = pool.findIndex((t) => t.id === closingId);
  return (pool[idx - 1] ?? pool[idx + 1]).id;
}

// Gap index is relative to the space's own strip, including the dragged tab.
export function reorderTabsByGap(
  tabs: Tab[],
  fromId: number,
  toGapIndex: number,
): Tab[] {
  const moved = tabs.find((t) => t.id === fromId);
  if (!moved) return tabs;
  const sameSpace = tabs.filter((t) => t.spaceId === moved.spaceId);
  const spaceFrom = sameSpace.findIndex((t) => t.id === fromId);
  let spaceTarget = toGapIndex > spaceFrom ? toGapIndex - 1 : toGapIndex;
  spaceTarget = Math.max(0, Math.min(spaceTarget, sameSpace.length - 1));
  if (spaceTarget === spaceFrom) return tabs;
  const anchor = sameSpace[spaceTarget];
  const next = tabs.filter((t) => t.id !== fromId);
  const anchorIdx = next.findIndex((t) => t.id === anchor.id);
  const insertIdx = spaceTarget > spaceFrom ? anchorIdx + 1 : anchorIdx;
  next.splice(insertIdx, 0, moved);
  return next;
}

export function planGitDiffOpen(
  tabs: Tab[],
  input: GitDiffOpenInput,
  spaceId: string,
  pin: boolean,
  allocId: () => number,
): { tabs: Tab[]; targetId: number } {
  const title = input.title ?? `${basename(input.path)} (${input.mode})`;
  const originalPath = input.originalPath ?? null;
  const matches = (tab: Tab): tab is GitDiffTab =>
    tab.kind === "git-diff" &&
    tab.spaceId === spaceId &&
    tab.repoRoot === input.repoRoot &&
    tab.path === input.path &&
    tab.mode === input.mode;
  const matchingTabs = tabs.filter(matches);
  const existing =
    matchingTabs.find((tab) => !tab.preview) ?? matchingTabs[0];

  if (existing) {
    const preview = pin ? false : existing.preview;
    if (
      existing.title === title &&
      existing.originalPath === originalPath &&
      existing.preview === preview
    ) {
      return { tabs, targetId: existing.id };
    }
    return {
      tabs: tabs.map((tab) =>
        tab.id === existing.id
          ? { ...existing, title, originalPath, preview }
          : tab,
      ),
      targetId: existing.id,
    };
  }

  const id = allocId();
  const tab = {
    id,
    kind: "git-diff",
    spaceId,
    title,
    path: input.path,
    repoRoot: input.repoRoot,
    mode: input.mode,
    originalPath,
    preview: !pin,
  } satisfies GitDiffTab;

  if (pin) return { tabs: [...tabs, tab], targetId: id };

  const previewIndex = tabs.findIndex(
    (candidate) =>
      candidate.kind === "git-diff" &&
      candidate.spaceId === spaceId &&
      candidate.preview,
  );
  if (previewIndex === -1) return { tabs: [...tabs, tab], targetId: id };

  const next = [...tabs];
  next[previewIndex] = tab;
  return { tabs: next, targetId: id };
}

export function planCommitHistoryOpen(
  tabs: Tab[],
  input: { repoRoot: string; branch?: string | null },
  spaceId: string,
  allocId: () => number,
): { tabs: Tab[]; targetId: number } {
  const existing = tabs.find(
    (tab) =>
      tab.kind === "git-history" &&
      tab.spaceId === spaceId &&
      tab.repoRoot === input.repoRoot,
  );
  const title = input.branch ? `History · ${input.branch}` : "Git History";
  if (existing) {
    if (existing.title === title) return { tabs, targetId: existing.id };
    return {
      tabs: tabs.map((tab) =>
        tab.id === existing.id ? { ...existing, title } : tab,
      ),
      targetId: existing.id,
    };
  }

  const id = allocId();
  return {
    tabs: [
      ...tabs,
      {
        id,
        kind: "git-history",
        spaceId,
        title,
        repoRoot: input.repoRoot,
      } satisfies GitHistoryTab,
    ],
    targetId: id,
  };
}

function coldTerminalTab(
  tabId: number,
  leafId: number,
  spaceId: string,
  cwd?: string,
): TerminalTab {
  return {
    id: tabId,
    kind: "terminal",
    spaceId,
    cold: true,
    title: cwd ? basename(cwd) : "shell",
    cwd,
    paneTree: { kind: "leaf", id: leafId, cwd },
    activeLeafId: leafId,
  };
}

// Plans the removal of a deleted space's tabs while keeping the invariant that
// the now-active `fallbackSpaceId` always has at least one tab (a cold one is
// spawned when it would be left empty). Returns null when nothing to remove.
export function planSpaceRemoval(
  tabs: Tab[],
  currentActiveId: number,
  spaceId: string,
  fallbackSpaceId: string,
  fallbackCwd: string | undefined,
  allocId: () => number,
): { tabs: Tab[]; disposeLeafIds: number[]; activeId: number } | null {
  const removed = tabs.filter((t) => t.spaceId === spaceId);
  if (removed.length === 0) return null;
  const disposeLeafIds = removed
    .filter((t) => t.kind === "terminal")
    .flatMap((t) => leafIds((t as TerminalTab).paneTree));
  let next = tabs.filter((t) => t.spaceId !== spaceId);
  let activeId = currentActiveId;
  if (!next.some((t) => t.spaceId === fallbackSpaceId)) {
    const tabId = allocId();
    next = [...next, coldTerminalTab(tabId, allocId(), fallbackSpaceId, fallbackCwd)];
    activeId = tabId;
  } else if (!next.some((t) => t.id === currentActiveId)) {
    const inFallback = next.filter((t) => t.spaceId === fallbackSpaceId);
    activeId = inFallback[inFallback.length - 1].id;
  }
  return { tabs: next, disposeLeafIds, activeId };
}
