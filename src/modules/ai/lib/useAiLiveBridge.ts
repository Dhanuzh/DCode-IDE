import { type RefObject, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  createReadinessTracker,
  type ManagedAgentId,
} from "@/modules/agents/lib/agentReadiness";
import {
  findAgentLauncher,
  validateAgentLaunchCommand,
} from "@/modules/agents/lib/launcher";
import { useManagedAgentsStore } from "@/modules/agents/store/managedAgentsStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  findLeafCwd,
  leafHasForegroundProcess,
  type TerminalPaneHandle,
  whenSessionReady,
  writeToSession,
} from "@/modules/terminal";
import type { Tab } from "@/modules/tabs";
import type { Live } from "../store/chatStore";
import { redactSensitive } from "./redact";

type TuiWaitResult = "ready" | "gone" | "timeout";

async function waitForAgentTuiReady(
  agent: ManagedAgentId,
  initial: string,
  readBuf: () => string | null,
  isRunning: () => Promise<boolean>,
  timeoutMs = 15_000,
): Promise<TuiWaitResult> {
  const tracker = createReadinessTracker(agent, initial);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const buf = readBuf();
    if (buf === null) return "gone";
    // After a failed launch the screen belongs to the shell again; only a
    // live foreground process may receive the prompt.
    if (tracker.observe(buf, Date.now()) && (await isRunning())) return "ready";
    await new Promise((r) => setTimeout(r, 120));
  }
  return "timeout";
}

type Params = {
  setLive: (live: Live) => void;
  activeId: number;
  tabs: Tab[];
  explorerRoot: string | null;
  launchCwd: string | null;
  home: string | null;
  openPreviewTab: (url: string) => void;
  newAgentTab: (
    cwd: string | undefined,
    title: string,
  ) => { tabId: number; leafId: number };
  terminalRefs: RefObject<Map<number, TerminalPaneHandle>>;
};

/**
 * Publishes the live workspace context (cwd, terminal buffer, active file,
 * managed-agent spawning, ...) into the chat store so AI tools can read and
 * act on the foreground state.
 *
 * The live object's getters read the latest state through a ref, so the bridge
 * is published once instead of re-running on every tab/cwd change — cwd updates
 * arrive from terminal OSC on shell output and would otherwise churn constantly.
 */
export function useAiLiveBridge(params: Params) {
  const { setLive, terminalRefs } = params;
  const ref = useRef(params);
  ref.current = params;

  useEffect(() => {
    const findCwd = () => {
      const { activeId, tabs, explorerRoot, launchCwd, home } = ref.current;
      const active = tabs.find((x) => x.id === activeId);
      if (active?.kind === "terminal") {
        return (
          findLeafCwd(active.paneTree, active.activeLeafId) ??
          active.cwd ??
          null
        );
      }
      for (let i = tabs.length - 1; i >= 0; i--) {
        const t = tabs[i];
        if (t.kind !== "terminal") continue;
        const cwd = findLeafCwd(t.paneTree, t.activeLeafId) ?? t.cwd;
        if (cwd) return cwd;
      }
      return explorerRoot ?? launchCwd ?? home ?? null;
    };

    setLive({
      getCwd: findCwd,
      getTerminalContext: () => {
        const { activeId, tabs } = ref.current;
        const t = tabs.find((x) => x.id === activeId);
        if (t?.kind !== "terminal") return null;
        if (t.private) return null;
        const buf = terminalRefs.current.get(t.activeLeafId)?.getBuffer(300);
        return buf ? redactSensitive(buf) : null;
      },
      isActiveTerminalPrivate: () => {
        const { activeId, tabs } = ref.current;
        const t = tabs.find((x) => x.id === activeId);
        return t?.kind === "terminal" && t.private === true;
      },
      injectIntoActivePty: (text) => {
        const { activeId, tabs } = ref.current;
        const t = tabs.find((x) => x.id === activeId);
        if (t?.kind !== "terminal") return false;
        const term = terminalRefs.current.get(t.activeLeafId);
        if (!term) return false;
        term.write(text);
        term.focus();
        return true;
      },
      getWorkspaceRoot: () => {
        const { explorerRoot, launchCwd, home } = ref.current;
        return explorerRoot ?? launchCwd ?? home ?? null;
      },
      getActiveFile: () => {
        const { activeId, tabs } = ref.current;
        const t = tabs.find((x) => x.id === activeId);
        return t?.kind === "editor" ? t.path : null;
      },
      openPreview: (url: string) => {
        ref.current.openPreviewTab(url);
        return true;
      },
      spawnManagedAgent: (
        prompt: string,
        sessionId: string,
        agent: ManagedAgentId,
      ) => {
        const trimmed = prompt.trim();
        if (!trimmed) return null;
        const oneLine = trimmed.replace(/\s*\r?\n\s*/g, " ");
        const cwd = findCwd();
        const short =
          oneLine.length > 32 ? `${oneLine.slice(0, 32)}…` : oneLine;
        const launcher = findAgentLauncher(agent);
        const command = validateAgentLaunchCommand(
          usePreferencesStore.getState().agentLaunchCommands[agent],
        );
        const launch = command.ok ? command.command : launcher.defaultCommand;
        const { tabId, leafId } = ref.current.newAgentTab(
          cwd ?? undefined,
          `${launcher.id} · ${short}`,
        );
        useManagedAgentsStore
          .getState()
          .register({ agent, leafId, tabId, sessionId, task: oneLine, cwd });
        const hooksReady = invoke("agent_enable_hooks", { agent }).catch(
          () => {},
        );
        void (async () => {
          await Promise.all([whenSessionReady(leafId), hooksReady]);
          const readBuf = () => {
            const term = terminalRefs.current.get(leafId);
            return term ? term.getBuffer(120) : null;
          };
          const initial = readBuf() ?? "";
          if (!writeToSession(leafId, `${launch}\r`)) {
            useManagedAgentsStore.getState().remove(leafId);
            return;
          }
          const result = await waitForAgentTuiReady(
            agent,
            initial,
            readBuf,
            () => leafHasForegroundProcess(leafId),
          );
          if (result !== "ready") {
            if (result === "timeout") {
              console.warn(
                `[dcode] ${launcher.label} did not become ready in time; aborting prompt send`,
              );
            }
            useManagedAgentsStore.getState().remove(leafId);
            return;
          }
          if (!writeToSession(leafId, `\x1b[200~${trimmed}\x1b[201~`)) {
            useManagedAgentsStore.getState().remove(leafId);
            return;
          }
          setTimeout(() => writeToSession(leafId, "\r"), 120);
          useManagedAgentsStore.getState().setPhase(leafId, "working");
        })();
        return { tabId, leafId };
      },
      readLeafBuffer: (leafId: number) => {
        const buf = terminalRefs.current.get(leafId)?.getBuffer(300);
        return buf ? redactSensitive(buf) : null;
      },
    });
  }, [setLive, terminalRefs]);
}
