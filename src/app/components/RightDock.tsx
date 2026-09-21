import { cn } from "@/lib/utils";
import { AiSidePanel } from "@/modules/ai";
import type { DockView } from "@/modules/ai/lib/dockLayout";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, Suspense } from "react";

type Props = {
  /** The built-in agent is only usable once a provider key is loaded. */
  hasComposer: boolean;
  extension: {
    label: string;
    iconSrc: string | null;
    panel: ReactNode;
  } | null;
};

/**
 * Right-hand dock shared by the built-in agent and a running extension's
 * views, so both live where the chat is expected instead of one sitting in the
 * file sidebar. Both panels stay mounted while the dock is open: an extension
 * webview that unmounts loses whatever it had on screen.
 */
export function RightDock({ hasComposer, extension }: Props) {
  const view = useChatStore((s) => s.dock.view);
  const showDockView = useChatStore((s) => s.showDockView);
  const active: DockView =
    extension && view === "extension" ? "extension" : "ai";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {extension && hasComposer ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-1.5 py-1">
          <DockTab
            active={active === "ai"}
            label="DCode"
            onClick={() => showDockView("ai")}
            icon={
              <HugeiconsIcon icon={SparklesIcon} size={12} strokeWidth={1.75} />
            }
          />
          <DockTab
            active={active === "extension"}
            label={extension.label}
            onClick={() => showDockView("extension")}
            icon={
              extension.iconSrc ? (
                <img
                  src={extension.iconSrc}
                  alt=""
                  className="size-3 rounded-[2px] object-contain"
                />
              ) : null
            }
          />
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {hasComposer ? (
          <div
            className={cn("absolute inset-0", active !== "ai" && "hidden")}
            aria-hidden={active !== "ai"}
          >
            <AiSidePanel />
          </div>
        ) : null}
        {extension ? (
          <div
            className={cn(
              "absolute inset-0",
              active !== "extension" && "hidden",
            )}
            aria-hidden={active !== "extension"}
          >
            <Suspense fallback={null}>{extension.panel}</Suspense>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DockTab({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] transition-colors",
        active
          ? "bg-foreground/[0.08] text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
