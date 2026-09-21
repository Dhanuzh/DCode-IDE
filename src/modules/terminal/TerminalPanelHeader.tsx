import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { TabIcon, TabRenameInput } from "@/modules/tabs/TabBar";
import { labelFor } from "@/modules/tabs/lib/tabLabel";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Delete02Icon,
  LayoutTwoColumnIcon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

export const TERMINAL_PANEL_HEADER_HEIGHT = 30;

type Props = {
  terminals: Tab[];
  selectedId: number | null;
  maximized: boolean;
  canSplit: boolean;
  onSelect: (id: number) => void;
  onNew: () => void;
  onSplit: () => void;
  onKill: (id: number) => void;
  onRename: (id: number, title: string) => void;
  onToggleMaximized: () => void;
  onClose: () => void;
  onResizeStart: (event: React.PointerEvent) => void;
};

export function TerminalPanelHeader({
  terminals,
  selectedId,
  maximized,
  canSplit,
  onSelect,
  onNew,
  onSplit,
  onKill,
  onRename,
  onToggleMaximized,
  onClose,
  onResizeStart,
}: Props) {
  const [editingId, setEditingId] = useState<number | null>(null);

  return (
    <div className="relative shrink-0">
      {maximized ? null : (
        <div
          onPointerDown={onResizeStart}
          className="absolute inset-x-0 -top-1 z-10 h-2 cursor-ns-resize"
          aria-hidden
        />
      )}
      <div
        style={{ height: TERMINAL_PANEL_HEADER_HEIGHT }}
        className="flex items-center gap-1 border-t border-border/60 bg-card/60 px-2"
      >
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Terminal
        </span>
        <div
          role="tablist"
          aria-label="Terminals"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto no-scrollbar"
        >
          {terminals.map((terminal) =>
            editingId === terminal.id ? (
              <div
                key={terminal.id}
                className="flex h-5 shrink-0 items-center gap-1 rounded bg-accent px-1.5 text-[11px]"
              >
                <TabIcon tab={terminal} />
                <TabRenameInput
                  initial={labelFor(terminal)}
                  onCommit={(value) => {
                    onRename(terminal.id, value);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            ) : (
              <ContextMenu key={terminal.id}>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={terminal.id === selectedId}
                    onClick={() => onSelect(terminal.id)}
                    onDoubleClick={() => setEditingId(terminal.id)}
                    onAuxClick={(e) => {
                      if (e.button !== 1) return;
                      e.preventDefault();
                      onKill(terminal.id);
                    }}
                    title={labelFor(terminal)}
                    className={cn(
                      "flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] transition-colors [&_svg]:size-3 [&_img]:size-3",
                      terminal.id === selectedId
                        ? "bg-foreground/[0.08] text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <TabIcon tab={terminal} />
                    <span className="max-w-28 truncate">
                      {labelFor(terminal)}
                    </span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent
                  className="min-w-32 p-1"
                  onCloseAutoFocus={(e) => e.preventDefault()}
                >
                  <ContextMenuItem
                    className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                    onSelect={() => setEditingId(terminal.id)}
                  >
                    <HugeiconsIcon
                      icon={PencilEdit02Icon}
                      size={13}
                      strokeWidth={1.75}
                    />
                    <span className="flex-1">Rename</span>
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                    onSelect={() => onKill(terminal.id)}
                  >
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      size={13}
                      strokeWidth={1.75}
                    />
                    <span className="flex-1">Kill terminal</span>
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ),
          )}
        </div>
        <PanelBtn title="New terminal" onClick={onNew}>
          <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={2} />
        </PanelBtn>
        <PanelBtn title="Split terminal" onClick={onSplit} disabled={!canSplit}>
          <HugeiconsIcon
            icon={LayoutTwoColumnIcon}
            size={12}
            strokeWidth={1.75}
          />
        </PanelBtn>
        <PanelBtn
          title="Kill terminal"
          onClick={() => selectedId != null && onKill(selectedId)}
          disabled={selectedId == null}
        >
          <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
        </PanelBtn>
        <PanelBtn
          title={maximized ? "Restore panel size" : "Maximize panel size"}
          onClick={onToggleMaximized}
        >
          <HugeiconsIcon
            icon={maximized ? ArrowDown01Icon : ArrowUp01Icon}
            size={12}
            strokeWidth={2}
          />
        </PanelBtn>
        <PanelBtn title="Close panel" onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </PanelBtn>
      </div>
    </div>
  );
}

function PanelBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}
