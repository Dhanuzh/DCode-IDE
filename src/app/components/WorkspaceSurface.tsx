import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import {
  type EditorAreaAction,
  EditorAreaEmpty,
} from "@/app/components/EditorAreaEmpty";
import { AiDiffStack, EditorStack, GitDiffStack } from "@/modules/editor";
import { GitHistoryStack } from "@/modules/git-history";
import { MarkdownStack } from "@/modules/markdown";
import { PreviewStack } from "@/modules/preview";
import type { Tab } from "@/modules/tabs";
import {
  TERMINAL_PANEL_HEADER_HEIGHT,
  TerminalPanelHeader,
  TerminalStack,
} from "@/modules/terminal";

type TerminalStackProps = ComponentProps<typeof TerminalStack>;
type EditorStackProps = ComponentProps<typeof EditorStack>;
type PreviewStackProps = ComponentProps<typeof PreviewStack>;
type AiDiffStackProps = ComponentProps<typeof AiDiffStack>;
type GitHistoryStackProps = ComponentProps<typeof GitHistoryStack>;

type Props = {
  tabs: Tab[];
  activeId: number;
  /** Tab on screen in the editor area; null renders the empty watermark. */
  editorAreaId: number | null;
  editorAreaActions: EditorAreaAction[];
  registerTerminalHandle: TerminalStackProps["registerHandle"];
  onSearchReady: TerminalStackProps["onSearchReady"];
  onCwd: TerminalStackProps["onCwd"];
  onExit: TerminalStackProps["onExit"];
  onFocusLeaf: TerminalStackProps["onFocusLeaf"];
  registerEditorHandle: EditorStackProps["registerHandle"];
  onEditorDirtyChange: EditorStackProps["onDirtyChange"];
  onEditorCloseTab: EditorStackProps["onCloseTab"];
  registerPreviewHandle: PreviewStackProps["registerHandle"];
  onPreviewUrlChange: PreviewStackProps["onUrlChange"];
  onAiDiffAccept: AiDiffStackProps["onAccept"];
  onAiDiffReject: AiDiffStackProps["onReject"];
  onOpenCommitFile: GitHistoryStackProps["onOpenCommitFile"];
  onGitHistorySearchHandle: GitHistoryStackProps["onSearchHandle"];
  onSetMarkdownView: EditorStackProps["onSetMarkdownView"];
  /** Focus moved into a region: make the tab it shows the active one. */
  onActivate: (id: number) => void;
  /** Bottom terminal panel. Terminals only ever render here. */
  panelVisible: boolean;
  panelMaximized: boolean;
  panelHeight: number;
  panelTerminals: Tab[];
  panelTerminalId: number | null;
  panelCanSplit: boolean;
  onPanelSelectTerminal: (id: number) => void;
  onPanelNewTerminal: () => void;
  onPanelSplitTerminal: () => void;
  onPanelKillTerminal: (id: number) => void;
  onPanelRenameTerminal: (id: number, title: string) => void;
  onPanelToggleMaximized: () => void;
  onPanelClose: () => void;
  onPanelResizeStart: (event: React.PointerEvent) => void;
};

/**
 * VS Code-style workbench: an editor area on top and the terminal panel below.
 * Every tab-kind surface stays mounted and is toggled by visibility, so panes
 * keep their state (terminal buffers, editor scroll, ...) when switching.
 */
export function WorkspaceSurface({
  tabs,
  activeId,
  editorAreaId,
  editorAreaActions,
  registerTerminalHandle,
  onSearchReady,
  onCwd,
  onExit,
  onFocusLeaf,
  registerEditorHandle,
  onEditorDirtyChange,
  onEditorCloseTab,
  registerPreviewHandle,
  onPreviewUrlChange,
  onAiDiffAccept,
  onAiDiffReject,
  onOpenCommitFile,
  onGitHistorySearchHandle,
  onSetMarkdownView,
  onActivate,
  panelVisible,
  panelMaximized,
  panelHeight,
  panelTerminals,
  panelTerminalId,
  panelCanSplit,
  onPanelSelectTerminal,
  onPanelNewTerminal,
  onPanelSplitTerminal,
  onPanelKillTerminal,
  onPanelRenameTerminal,
  onPanelToggleMaximized,
  onPanelClose,
  onPanelResizeStart,
}: Props) {
  const areaId = editorAreaId ?? -1;
  const kind = tabs.find((t) => t.id === editorAreaId)?.kind;
  const isEditorTab = kind === "editor";
  const isPreviewTab = kind === "preview";
  const isMarkdownTab = kind === "markdown";
  const isAiDiffTab = kind === "ai-diff";
  const isGitDiffTab = kind === "git-diff" || kind === "git-commit-file";
  const isGitHistoryTab = kind === "git-history";

  // A maximized panel takes the editor area's space; nothing else hides it.
  const panelFills = panelVisible && panelMaximized;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn("relative min-h-0 flex-1", panelFills && "hidden")}
        aria-hidden={panelFills}
        onFocusCapture={() => {
          if (editorAreaId !== null && editorAreaId !== activeId) {
            onActivate(editorAreaId);
          }
        }}
      >
        {editorAreaId === null ? (
          <EditorAreaEmpty actions={editorAreaActions} />
        ) : null}
        <div
          className={cn(
            "absolute inset-0 px-3 pt-2 pb-2",
            !isEditorTab && "invisible pointer-events-none",
          )}
          aria-hidden={!isEditorTab}
        >
          <EditorStack
            tabs={tabs}
            activeId={areaId}
            registerHandle={registerEditorHandle}
            onDirtyChange={onEditorDirtyChange}
            onCloseTab={onEditorCloseTab}
            onSetMarkdownView={onSetMarkdownView}
          />
        </div>
        <div
          className={cn(
            "absolute inset-0 px-3 pt-2 pb-2",
            !isPreviewTab && "invisible pointer-events-none",
          )}
          aria-hidden={!isPreviewTab}
        >
          <PreviewStack
            tabs={tabs}
            activeId={areaId}
            registerHandle={registerPreviewHandle}
            onUrlChange={onPreviewUrlChange}
          />
        </div>
        <div
          className={cn(
            "absolute inset-0 px-3 pt-2 pb-2",
            !isMarkdownTab && "invisible pointer-events-none",
          )}
          aria-hidden={!isMarkdownTab}
        >
          <MarkdownStack
            tabs={tabs}
            activeId={areaId}
            onSetMarkdownView={onSetMarkdownView}
          />
        </div>
        <div
          className={cn(
            "absolute inset-0 px-3 pt-2 pb-2",
            !isAiDiffTab && "invisible pointer-events-none",
          )}
          aria-hidden={!isAiDiffTab}
        >
          <AiDiffStack
            tabs={tabs}
            activeId={areaId}
            onAccept={onAiDiffAccept}
            onReject={onAiDiffReject}
          />
        </div>
        <div
          className={cn(
            "absolute inset-0 px-3 pt-2 pb-2",
            !isGitDiffTab && "invisible pointer-events-none",
          )}
          aria-hidden={!isGitDiffTab}
        >
          <GitDiffStack tabs={tabs} activeId={areaId} />
        </div>
        <div
          className={cn(
            "absolute inset-0",
            !isGitHistoryTab && "invisible pointer-events-none",
          )}
          aria-hidden={!isGitHistoryTab}
        >
          <GitHistoryStack
            tabs={tabs}
            activeId={areaId}
            onOpenCommitFile={onOpenCommitFile}
            onSearchHandle={onGitHistorySearchHandle}
          />
        </div>
      </div>

      {/* The terminal region keeps a fixed position in the tree: it only
          changes size or hides, so opening, closing or maximizing the panel
          never remounts a pane (which would respawn every PTY). */}
      <div
        className={cn(
          "flex min-h-0 flex-col",
          panelFills && "flex-1",
          !panelVisible && "hidden",
        )}
        style={
          panelVisible && !panelFills
            ? { height: panelHeight + TERMINAL_PANEL_HEADER_HEIGHT }
            : undefined
        }
        aria-hidden={!panelVisible}
      >
        {panelVisible ? (
          <TerminalPanelHeader
            terminals={panelTerminals}
            selectedId={panelTerminalId}
            maximized={panelMaximized}
            canSplit={panelCanSplit}
            onSelect={onPanelSelectTerminal}
            onNew={onPanelNewTerminal}
            onSplit={onPanelSplitTerminal}
            onKill={onPanelKillTerminal}
            onRename={onPanelRenameTerminal}
            onToggleMaximized={onPanelToggleMaximized}
            onClose={onPanelClose}
            onResizeStart={onPanelResizeStart}
          />
        ) : null}
        <div
          className="relative min-h-0 flex-1 px-3 pt-2 pb-2"
          onFocusCapture={() => {
            if (panelTerminalId !== null && panelTerminalId !== activeId) {
              onActivate(panelTerminalId);
            }
          }}
        >
          <TerminalStack
            tabs={tabs}
            activeId={panelTerminalId ?? -1}
            registerHandle={registerTerminalHandle}
            onSearchReady={onSearchReady}
            onCwd={onCwd}
            onExit={onExit}
            onFocusLeaf={onFocusLeaf}
          />
        </div>
      </div>
    </div>
  );
}
