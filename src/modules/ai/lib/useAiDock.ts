import { useCallback, useEffect, useRef } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import {
  readDockWidth,
  shouldPersistDockWidth,
  writeDockWidth,
} from "./dockLayout";

const WIDTH_WRITE_DEBOUNCE_MS = 200;

export function useAiDock() {
  const dockRef = useRef<PanelImperativeHandle | null>(null);
  const dockWidthRef = useRef(readDockWidth());
  const writeTimerRef = useRef(0);

  const persistDockWidth = useCallback(
    (next: number, isUserInteraction: boolean) => {
      if (!shouldPersistDockWidth(next, isUserInteraction)) return;
      dockWidthRef.current = next;
      if (writeTimerRef.current) window.clearTimeout(writeTimerRef.current);
      writeTimerRef.current = window.setTimeout(() => {
        writeTimerRef.current = 0;
        writeDockWidth(next);
      }, WIDTH_WRITE_DEBOUNCE_MS);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (writeTimerRef.current) window.clearTimeout(writeTimerRef.current);
    };
  }, []);

  return { dockRef, dockWidthRef, persistDockWidth };
}
