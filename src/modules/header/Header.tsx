import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { NotificationBell } from "@/modules/agents";
import type { ExtensionLaunch } from "@/modules/sidebar";
import type { AgentLaunchRequest } from "@/modules/agents/lib/launcher";
import type { Tab } from "@/modules/tabs";
import { TabBar } from "@/modules/tabs";
import {
  CommandIcon,
  PuzzleIcon,
  Settings01Icon,
  SidebarLeftIcon,
  SidebarRightIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  SearchInline,
  type SearchInlineHandle,
  type SearchTarget,
} from "./SearchInline";

type Props = {
  tabs: Tab[];
  activeId: number;
  allowCloseLast?: boolean;
  onSelect: (id: number) => void;
  onNew: () => void;
  onNewBlock: () => void;
  onNewPrivate: () => void;
  onNewPreview: () => void;
  onNewEditor: () => void;
  onNewGitGraph: () => void;
  onNewSsh: () => void;
  onOpenFolder: () => void;
  onOpenFile: () => void;
  onOpenFolderInNewSpace: () => void;
  onLaunchAgents: (request: AgentLaunchRequest) => void;
  onClose: (id: number) => void;
  /** Promote a preview (transient) tab to persistent. */
  onPin: (id: number) => void;
  /** Set a terminal tab's custom label; empty string resets to default. */
  onRename: (id: number, title: string) => void;
  /** Move a dragged tab to a new position (insertion gap index). */
  onReorder: (fromId: number, toGapIndex: number) => void;
  onOverrideLanguage?: (id: number, lang: string | null) => void;
  onToggleSidebar: () => void;
  onToggleAiDock: () => void;
  /** Run / reveal installed code extensions, shown beside Settings. */
  extensionLaunchers?: ExtensionLaunch[];
  aiDockOpen: boolean;
  onOpenCommandPalette: () => void;
  onActivateAgent: (tabId: number, leafId: number) => void;
  onActivateLocalAgent: () => void;
  onOpenSettings: () => void;
  spaceSwitcher: ReactNode;
  searchTarget: SearchTarget;
  searchRef: RefObject<SearchInlineHandle | null>;
};

const COMPACT_WIDTH = 720;

export function Header({
  tabs,
  activeId,
  allowCloseLast,
  onSelect,
  onNew,
  onNewBlock,
  onNewPrivate,
  onNewPreview,
  onNewEditor,
  onNewGitGraph,
  onNewSsh,
  onOpenFolder,
  onOpenFile,
  onOpenFolderInNewSpace,
  onLaunchAgents,
  onClose,
  onPin,
  onRename,
  onReorder,
  onOverrideLanguage,
  onToggleSidebar,
  onToggleAiDock,
  extensionLaunchers,
  aiDockOpen,
  onOpenCommandPalette,
  onActivateAgent,
  onActivateLocalAgent,
  onOpenSettings,
  spaceSwitcher,
  searchTarget,
  searchRef,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCompact(w < COMPACT_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aiDockButton = (
    <Button
      variant="ghost"
      size="icon"
      aria-pressed={aiDockOpen}
      className={cn(
        "size-7 shrink-0 rounded-md hover:bg-accent hover:text-foreground",
        aiDockOpen
          ? "bg-foreground/[0.07] text-foreground"
          : "text-muted-foreground",
      )}
      onClick={onToggleAiDock}
      title={`${aiDockOpen ? "Hide" : "Show"} AI sidebar`}
    >
      <HugeiconsIcon icon={SidebarRightIcon} size={15} strokeWidth={1.75} />
    </Button>
  );

  // One button per installed code extension. Only one can run at a time, so
  // clicking another switches to it.
  const extensionButtons = (extensionLaunchers ?? []).map((launcher) => (
    <Button
      key={launcher.id}
      variant="ghost"
      size="icon"
      aria-pressed={launcher.running}
      className={cn(
        "relative size-7 shrink-0 rounded-md hover:bg-accent hover:text-foreground",
        launcher.running
          ? "bg-foreground/[0.07] text-foreground"
          : "text-muted-foreground",
      )}
      onClick={launcher.onClick}
      title={
        launcher.running
          ? `${launcher.label} is running`
          : `Run ${launcher.label}`
      }
    >
      {launcher.iconSrc ? (
        <img
          src={launcher.iconSrc}
          alt=""
          className={cn(
            "size-4 rounded-[3px] object-contain",
            !launcher.running && "opacity-70",
          )}
        />
      ) : (
        <HugeiconsIcon icon={PuzzleIcon} size={15} strokeWidth={1.75} />
      )}
      {launcher.running ? (
        <span
          aria-hidden
          className="absolute bottom-0.5 right-0.5 size-1.5 rounded-full bg-emerald-500"
        />
      ) : null}
    </Button>
  ));

  const settingsButton = (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={onOpenSettings}
      title="Settings"
    >
      <HugeiconsIcon icon={Settings01Icon} size={15} strokeWidth={1.75} />
    </Button>
  );

  return (
    <div
      ref={rootRef}
      data-tauri-drag-region
      className={`flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-card select-none ${
        IS_MAC ? "pr-2 pl-20" : "pr-0 pl-2"
      }`}
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          onClick={onToggleSidebar}
          title="Toggle sidebar"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={SidebarLeftIcon} size={18} strokeWidth={1.75} />
        </Button>

        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onOpenCommandPalette}
          title="Command palette"
          className="shrink-0 gap-1.5 rounded-md px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={CommandIcon} size={14} strokeWidth={1.75} />
        </Button>

        {!IS_MAC && (
          <NotificationBell
            onActivate={onActivateAgent}
            onActivateLocal={onActivateLocalAgent}
          />
        )}
      </div>

      {!IS_MAC && <span className="mx-1 h-full w-px shrink-0 bg-border/70" />}

      {IS_MAC && <span className="mr-1 h-full w-px shrink-0 bg-border/70" />}

      <div
        className="flex min-w-0 flex-1 items-center gap-2"
        data-tauri-drag-region
      >
        {spaceSwitcher}
        <TabBar
          tabs={tabs}
          activeId={activeId}
          allowCloseLast={allowCloseLast}
          onSelect={onSelect}
          onNew={onNew}
          onNewBlock={onNewBlock}
          onNewPrivate={onNewPrivate}
          onNewPreview={onNewPreview}
          onNewEditor={onNewEditor}
          onNewGitGraph={onNewGitGraph}
          onNewSsh={onNewSsh}
          onOpenFolder={onOpenFolder}
          onOpenFile={onOpenFile}
          onOpenFolderInNewSpace={onOpenFolderInNewSpace}
          onLaunchAgents={onLaunchAgents}
          onClose={onClose}
          onPin={onPin}
          onRename={onRename}
          onReorder={onReorder}
          onOverrideLanguage={onOverrideLanguage}
          compact={compact}
        />
        <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
      </div>

      <SearchInline ref={searchRef} target={searchTarget} compact={compact} />

      {IS_MAC && (
        <>
          <NotificationBell
            onActivate={onActivateAgent}
            onActivateLocal={onActivateLocalAgent}
          />
          {extensionButtons}
          {aiDockButton}
          {settingsButton}
        </>
      )}

      {!IS_MAC && (
        <>
          {extensionButtons}
          {aiDockButton}
          {settingsButton}
        </>
      )}

      {USE_CUSTOM_WINDOW_CONTROLS && (
        <>
          <span className="ml-1 h-5 w-px shrink-0 bg-border/60" />
          <WindowControls />
        </>
      )}
    </div>
  );
}
