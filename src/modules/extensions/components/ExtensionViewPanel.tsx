import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { useExtHostStore } from "../host/extHostStore";
import { ExtensionWebview } from "./ExtensionWebview";

/** Sidebar surface for the running extension's webview views. */
export function ExtensionViewPanel() {
  const webviews = useExtHostStore((s) => s.webviews);
  const phase = useExtHostStore((s) => s.phase);
  const setWebviewVisible = useExtHostStore((s) => s.setWebviewVisible);
  const [activeId, setActiveId] = useState<string | null>(null);

  const active = webviews.find((w) => w.viewId === activeId) ?? webviews[0];
  const activeViewId = active?.viewId ?? null;

  // A view keeps its frame once opened: switching tabs must not reload the
  // extension's UI, which would throw away whatever it had on screen.
  const [opened, setOpened] = useState<string[]>([]);
  useEffect(() => {
    if (!activeViewId) return;
    setOpened((prev) =>
      prev.includes(activeViewId) ? prev : [...prev, activeViewId],
    );
  }, [activeViewId]);

  // Extensions render differently when hidden (and stop work they would waste),
  // so they are told which view is on screen.
  useEffect(() => {
    for (const viewId of opened) {
      setWebviewVisible(viewId, viewId === activeViewId);
    }
  }, [opened, activeViewId, setWebviewVisible]);

  if (webviews.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[11px] leading-relaxed text-muted-foreground">
        {phase === "activated"
          ? "This extension registered no views."
          : "Run an extension from the Extensions panel to see its views here."}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {webviews.length > 1 ? (
        <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/60 px-1.5 py-1 no-scrollbar">
          {webviews.map((view) => (
            <button
              key={view.viewId}
              type="button"
              onClick={() => setActiveId(view.viewId)}
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10.5px] transition-colors",
                view.viewId === activeViewId
                  ? "bg-foreground/[0.08] text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              {view.viewId}
            </button>
          ))}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {webviews
          .filter((view) => opened.includes(view.viewId))
          .map((view) => (
            <div
              key={view.viewId}
              className={cn(
                "absolute inset-0",
                view.viewId !== activeViewId && "hidden",
              )}
              aria-hidden={view.viewId !== activeViewId}
            >
              <ExtensionWebview view={view} />
            </div>
          ))}
      </div>
    </div>
  );
}
