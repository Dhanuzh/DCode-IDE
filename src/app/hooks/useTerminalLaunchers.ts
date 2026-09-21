import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import {
  type AgentInstanceCount,
  type AgentLaunchRequest,
  findAgentLauncher,
  validateAgentLaunchCommand,
} from "@/modules/agents/lib/launcher";
import {
  buildSshCommand,
  formatSshTarget,
  type SshTarget,
} from "@/modules/ssh";
import { whenSessionReady, writeToSession } from "@/modules/terminal";

type Options = {
  cwdForNewTab: () => string | undefined;
  newAgentGroupTab: (
    cwd: string | undefined,
    title: string,
    instances: AgentInstanceCount,
  ) => { tabId: number; leafIds: number[] };
};

/** Types a start command into a fresh leaf once its shell is ready. */
function launchInLeaf(
  leafId: number,
  command: string,
  label: string,
  before: Promise<unknown> = Promise.resolve(),
): void {
  void (async () => {
    await Promise.all([whenSessionReady(leafId), before]);
    if (!writeToSession(leafId, `${command}\r`)) {
      console.error(`[dcode] ${label} terminal ${leafId} closed before launch`);
    }
  })();
}

/** Opens terminal tabs that start a program: coding agents and SSH sessions. */
export function useTerminalLaunchers({
  cwdForNewTab,
  newAgentGroupTab,
}: Options) {
  const launchAgentGroup = useCallback(
    (request: AgentLaunchRequest) => {
      const command = validateAgentLaunchCommand(request.command);
      if (!command.ok) return;
      const launcher = findAgentLauncher(request.agent);
      const title =
        request.instances === 1
          ? launcher.label
          : `${launcher.label} × ${request.instances}`;
      const { leafIds } = newAgentGroupTab(
        cwdForNewTab(),
        title,
        request.instances,
      );
      const hooksReady = launcher.supportsHooks
        ? invoke("agent_enable_hooks", { agent: request.agent }).catch(
            (error) => {
              console.warn(
                `[dcode] could not enable ${request.agent} notifications:`,
                error,
              );
            },
          )
        : Promise.resolve();
      for (const leafId of leafIds) {
        launchInLeaf(leafId, command.command, "agent", hooksReady);
      }
    },
    [cwdForNewTab, newAgentGroupTab],
  );

  const openSshTab = useCallback(
    (target: SshTarget) => {
      const { leafIds } = newAgentGroupTab(
        cwdForNewTab(),
        `ssh ${formatSshTarget(target)}`,
        1,
      );
      launchInLeaf(leafIds[0], buildSshCommand(target), "ssh");
    },
    [cwdForNewTab, newAgentGroupTab],
  );

  return { launchAgentGroup, openSshTab };
}
