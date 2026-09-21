import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  isPanelTab,
  MAX_PANES_PER_TAB,
  resolveEditorAreaId,
  resolvePanelTerminalId,
  type Tab,
} from "@/modules/tabs";
import { leafIds, useTerminalPanel } from "@/modules/terminal";

type Options = {
  /** Tabs of the active space, in strip order. */
  spaceTabs: Tab[];
  activeId: number;
  setActiveId: (id: number) => void;
  /** Creates a terminal tab, activates it, and returns its id. */
  newTerminal: () => number;
  splitPane: (tabId: number, dir: "row" | "col") => void;
  focusTerminal: (tabId: number) => void;
  focusEditorArea: (tabId: number) => void;
};

/**
 * VS Code-style workbench state: which tab the editor area shows, which
 * terminal the bottom panel shows, and the panel's open/maximized state.
 * Terminals only ever render in the panel, so activating one opens it.
 */
export function useWorkbenchLayout({
  spaceTabs,
  activeId,
  setActiveId,
  newTerminal,
  splitPane,
  focusTerminal,
  focusEditorArea,
}: Options) {
  const panel = useTerminalPanel();
  const {
    open,
    setOpen,
    maximized,
    setMaximized,
    toggleMaximized,
    selectedId,
    setSelectedId,
  } = panel;
  const [lastEditorAreaId, setLastEditorAreaId] = useState<number | null>(null);

  const activeTab = spaceTabs.find((t) => t.id === activeId);
  const activeInPanel = activeTab ? isPanelTab(activeTab) : false;
  const editorAreaId = resolveEditorAreaId(
    spaceTabs,
    activeId,
    lastEditorAreaId,
  );
  const panelTerminalId = resolvePanelTerminalId(
    spaceTabs,
    activeId,
    selectedId,
  );
  const editorAreaTabs = spaceTabs.filter((t) => !isPanelTab(t));
  const panelTerminals = spaceTabs.filter(isPanelTab);
  const panelVisible = open && panelTerminals.length > 0;
  const panelTab = panelTerminals.find((t) => t.id === panelTerminalId);
  const panelCanSplit =
    panelTab?.kind === "terminal" &&
    !panelTab.blocks &&
    leafIds(panelTab.paneTree).length < MAX_PANES_PER_TAB;

  const activeKind = activeTab ? (activeInPanel ? "panel" : "editor") : null;

  // Runs before paint so activating a terminal never flashes a closed panel,
  // and activating an editor never leaves it hidden behind a maximized panel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on activation only, so closing the panel over an active terminal does not reopen it
  useLayoutEffect(() => {
    if (activeKind === "panel") {
      setSelectedId(activeId);
      if (!open) setOpen(true);
    } else if (activeKind === "editor") {
      setLastEditorAreaId(activeId);
      if (maximized) setMaximized(false);
    }
  }, [activeId, activeKind]);

  // Keyboard focus follows the active tab across regions. An editor-area tab
  // only takes focus away from the panel, so explorer keyboard navigation that
  // opens previews keeps its focus.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on activation only; the focus callbacks read live refs
  useEffect(() => {
    if (activeKind === "panel") {
      focusTerminal(activeId);
      return;
    }
    if (activeKind !== "editor") return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.closest(".xterm")) {
      focusEditorArea(activeId);
    }
  }, [activeId, activeKind]);

  const activate = useCallback(
    (id: number) => {
      if (id !== activeId) setActiveId(id);
    },
    [activeId, setActiveId],
  );

  const selectPanelTerminal = useCallback(
    (id: number) => {
      setSelectedId(id);
      setActiveId(id);
    },
    [setSelectedId, setActiveId],
  );

  const newTerminalInPanel = useCallback(() => {
    setSelectedId(newTerminal());
    setOpen(true);
  }, [newTerminal, setSelectedId, setOpen]);

  const closePanel = useCallback(() => {
    setOpen(false);
    if (activeInPanel && editorAreaId !== null) setActiveId(editorAreaId);
  }, [setOpen, activeInPanel, editorAreaId, setActiveId]);

  const togglePanel = useCallback(() => {
    if (panelVisible) {
      closePanel();
      return;
    }
    if (panelTerminalId === null) {
      newTerminalInPanel();
      return;
    }
    setOpen(true);
    setActiveId(panelTerminalId);
    // Already active (panel was closed over it): the activation effects will
    // not rerun, so focus explicitly once the panel is laid out.
    if (panelTerminalId === activeId) {
      requestAnimationFrame(() => focusTerminal(panelTerminalId));
    }
  }, [
    panelVisible,
    closePanel,
    panelTerminalId,
    newTerminalInPanel,
    setOpen,
    setActiveId,
    activeId,
    focusTerminal,
  ]);

  const splitPanelTerminal = useCallback(() => {
    if (panelTerminalId === null) return;
    setActiveId(panelTerminalId);
    splitPane(panelTerminalId, "row");
  }, [panelTerminalId, setActiveId, splitPane]);

  const togglePanelMaximized = useCallback(() => {
    if (!panelVisible) {
      if (panelTerminalId === null) return;
      setOpen(true);
      setMaximized(true);
      setActiveId(panelTerminalId);
      return;
    }
    toggleMaximized();
  }, [
    panelVisible,
    panelTerminalId,
    setOpen,
    setMaximized,
    setActiveId,
    toggleMaximized,
  ]);

  return {
    editorAreaId,
    editorAreaTabs,
    panelTerminals,
    panelTerminalId,
    panelVisible,
    panelMaximized: maximized,
    panelHeight: panel.height,
    panelCanSplit,
    startPanelResize: panel.startResize,
    activate,
    selectPanelTerminal,
    newTerminalInPanel,
    closePanel,
    togglePanel,
    splitPanelTerminal,
    togglePanelMaximized,
  };
}
