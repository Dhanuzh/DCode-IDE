import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampPanelHeight,
  heightFromDrag,
  readPanelHeight,
  readPanelMaximized,
  readPanelOpen,
  writePanelHeight,
  writePanelMaximized,
  writePanelOpen,
} from "./terminalPanel";

const WRITE_DEBOUNCE_MS = 200;

/**
 * VS Code-style bottom terminal panel: open state, drag-resizable height,
 * maximized state, and which terminal tab the panel shows while an editor tab
 * is focused.
 */
export function useTerminalPanel() {
  const [open, setOpen] = useState(readPanelOpen);
  const [maximized, setMaximized] = useState(readPanelMaximized);
  const [height, setHeight] = useState(readPanelHeight);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const writeTimerRef = useRef(0);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    if (writeTimerRef.current) window.clearTimeout(writeTimerRef.current);
    writeTimerRef.current = window.setTimeout(() => {
      writeTimerRef.current = 0;
      writePanelHeight(height);
    }, WRITE_DEBOUNCE_MS);
    return () => {
      if (writeTimerRef.current) window.clearTimeout(writeTimerRef.current);
    };
  }, [height]);

  const setOpenPersisted = useCallback((next: boolean) => {
    writePanelOpen(next);
    setOpen(next);
  }, []);

  const toggle = useCallback(() => {
    setOpen((current) => {
      writePanelOpen(!current);
      return !current;
    });
  }, []);

  const setMaximizedPersisted = useCallback((next: boolean) => {
    writePanelMaximized(next);
    setMaximized(next);
  }, []);

  const toggleMaximized = useCallback(() => {
    setMaximized((current) => {
      writePanelMaximized(!current);
      return !current;
    });
  }, []);

  const startResize = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      dragRef.current = { startY: event.clientY, startHeight: height };
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);

      const onMove = (move: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        setHeight(
          heightFromDrag(
            drag.startHeight,
            drag.startY,
            move.clientY,
            window.innerHeight,
          ),
        );
      };
      const onUp = () => {
        dragRef.current = null;
        target.releasePointerCapture?.(event.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [height],
  );

  // A shorter window must not leave the panel taller than the editor area.
  useEffect(() => {
    const onResize = () =>
      setHeight((current) => clampPanelHeight(current, window.innerHeight));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return {
    open,
    setOpen: setOpenPersisted,
    toggle,
    maximized,
    setMaximized: setMaximizedPersisted,
    toggleMaximized,
    height,
    startResize,
    selectedId,
    setSelectedId,
  };
}
