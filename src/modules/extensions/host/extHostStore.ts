import { openExternalUrl, isExternalUrl } from "@/lib/external-link";
import { currentWorkspaceEnv, wslToWindows } from "@/modules/workspace";
import { Channel, invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { create } from "zustand";
import type { InstalledExt } from "../lib/native";
import { webviewUrlPrefix } from "./webviewHtml";
import {
  extTerminalBridge,
  sanitizeTerminalText,
  type ExtTerminalOptions,
} from "./terminalBridge";
import {
  appendLog,
  type HostEvent,
  type HostMessage,
  type HostPhase,
  type HostStatus,
} from "./protocol";

export type WebviewState = {
  viewId: string;
  /** Set once the extension resolves the view and assigns its HTML. */
  html: string | null;
  resolving: boolean;
  error: string | null;
  /** Failures reported by the page itself (dead assets, CSP refusals). */
  runtimeErrors: string[];
};

/** Enough to explain a blank view without growing without bound. */
const MAX_WEBVIEW_ERRORS = 5;

type State = {
  status: HostStatus | null;
  phase: HostPhase;
  runningId: string | null;
  commands: string[];
  logs: string[];
  error: string | null;
  /** Webview views the running extension registered, in registration order. */
  webviews: WebviewState[];

  refreshStatus: () => Promise<void>;
  resolveWebview: (viewId: string) => Promise<void>;
  postToWebview: (viewId: string, message: unknown) => Promise<void>;
  /** Runtime errors reported by a webview's own page. */
  noteWebviewError: (viewId: string, message: string) => void;
  clearWebviewErrors: (viewId: string) => void;
  /** Tells the extension which of its views is on screen. */
  setWebviewVisible: (viewId: string, visible: boolean) => void;
  run: (extension: InstalledExt, workspaceRoot: string | null) => Promise<void>;
  stop: () => Promise<void>;
  executeCommand: (id: string) => Promise<void>;
};

let requestId = 1;

/** Extension secrets live in the OS keychain, never in the state file. */
const EXT_KEYRING_SERVICE = "dcode-extensions";

/** Keychain account for one extension's secret, or null when unusable. */
export function secretAccount(
  extensionId: string | null,
  key: unknown,
): string | null {
  if (!extensionId || typeof key !== "string" || !key) return null;
  if (key.length > 128 || /[\u0000-\u001f]/.test(key)) return null;
  return `${extensionId}:${key}`;
}

function reply(id: number, result: unknown, error?: string) {
  void invoke("ext_host_send", {
    message: {
      type: "rpcResult",
      id,
      result: result ?? null,
      error: error ?? null,
    },
  });
}

export const useExtHostStore = create<State>((set, get) => ({
  status: null,
  phase: "idle",
  runningId: null,
  commands: [],
  logs: [],
  error: null,
  webviews: [],

  refreshStatus: async () => {
    try {
      set({ status: await invoke<HostStatus>("ext_host_status") });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  run: async (extension, workspaceRoot) => {
    // The host is a Node process on the host OS, so it cannot stat a WSL path:
    // `/mnt/d/proj` would resolve to `C:\mnt\d\proj`. Hand it the Windows
    // form of the same directory instead.
    const env = currentWorkspaceEnv();
    const hostWorkspaceRoot =
      workspaceRoot && env.kind === "wsl"
        ? wslToWindows(workspaceRoot, env.distro)
        : workspaceRoot;
    const main = extension.main;
    if (!main) {
      set({ error: "this extension has no code entrypoint" });
      return;
    }
    set({
      phase: "starting",
      runningId: extension.id,
      commands: [],
      logs: [],
      error: null,
      webviews: [],
    });

    const channel = new Channel<HostEvent>();
    channel.onmessage = (event) => {
      if (event.kind === "stderr") {
        set((s) => ({ logs: appendLog(s.logs, `stderr: ${event.line}`) }));
        return;
      }
      if (event.kind === "exit") {
        set((s) => ({
          phase: s.phase === "failed" ? "failed" : "exited",
          logs: appendLog(s.logs, `host exited (${event.code ?? "signal"})`),
        }));
        return;
      }
      handleMessage(event.payload, set, get);
    };

    try {
      await invoke("ext_host_start", {
        args: {
          extensionId: extension.id,
          extensionPath: extension.dir,
          main,
          workspaceRoot: hostWorkspaceRoot,
          // `asWebviewUri` builds URLs with this, so a resource the page
          // requests at runtime loads as-is instead of needing HTML rewriting.
          webviewUrlPrefix: webviewUrlPrefix(),
        },
        onEvent: channel,
      });
    } catch (error) {
      set({ phase: "failed", error: String(error) });
    }
  },

  stop: async () => {
    try {
      await invoke("ext_host_stop");
    } finally {
      set({ phase: "idle", runningId: null, commands: [], webviews: [] });
    }
  },

  resolveWebview: async (viewId) => {
    set((s) => ({
      webviews: s.webviews.map((w) =>
        w.viewId === viewId ? { ...w, resolving: true, error: null } : w,
      ),
    }));
    await invoke("ext_host_send", {
      message: { type: "resolveWebview", viewId },
    });
  },

  postToWebview: async (viewId, message) => {
    await invoke("ext_host_send", {
      message: { type: "webviewMessage", viewId, message },
    });
  },

  noteWebviewError: (viewId, message) => {
    set((s) => ({
      logs: appendLog(s.logs, `webview error (${viewId}): ${message}`),
      webviews: s.webviews.map((w) =>
        w.viewId !== viewId || w.runtimeErrors.includes(message)
          ? w
          : {
              ...w,
              runtimeErrors: [...w.runtimeErrors, message].slice(
                -MAX_WEBVIEW_ERRORS,
              ),
            },
      ),
    }));
  },

  setWebviewVisible: (viewId, visible) => {
    void invoke("ext_host_send", {
      message: { type: "webviewVisibility", viewId, visible },
    });
  },

  clearWebviewErrors: (viewId) => {
    set((s) => ({
      webviews: s.webviews.map((w) =>
        w.viewId === viewId ? { ...w, runtimeErrors: [] } : w,
      ),
    }));
  },

  executeCommand: async (id) => {
    await invoke("ext_host_send", {
      message: { type: "executeCommand", requestId: requestId++, id, args: [] },
    });
  },
}));

function handleMessage(
  message: HostMessage,
  set: (partial: Partial<State> | ((s: State) => Partial<State>)) => void,
  get: () => State,
) {
  switch (message.type) {
    case "ready":
      set((s) => ({
        logs: appendLog(s.logs, `host ready on Node ${message.node}`),
      }));
      break;
    case "activated":
      set((s) => ({
        phase: "activated",
        commands: message.commands,
        logs: appendLog(
          s.logs,
          `activated with ${message.commands.length} command(s)`,
        ),
      }));
      break;
    case "activationFailed":
      set((s) => ({
        phase: "failed",
        error: message.message,
        logs: appendLog(s.logs, `activation failed: ${message.message}`),
      }));
      break;
    case "log":
      set((s) => ({
        logs: appendLog(s.logs, `[${message.level}] ${message.message}`),
      }));
      break;
    case "notify":
      handleNotify(message.method, message.params, set);
      break;
    case "rpc":
      handleRpc(message.id, message.method, message.params, get, set);
      break;
    case "webviewFailed":
      set((s) => ({
        webviews: s.webviews.map((w) =>
          w.viewId === message.viewId
            ? { ...w, resolving: false, error: message.message }
            : w,
        ),
        logs: appendLog(s.logs, `webview failed: ${message.message}`),
      }));
      break;
    case "commandResult":
      if (message.error) {
        set((s) => ({
          logs: appendLog(s.logs, `command failed: ${message.error}`),
        }));
      }
      break;
    default:
      break;
  }
}

function handleNotify(
  method: string,
  params: Record<string, unknown>,
  set: (partial: (s: State) => Partial<State>) => void,
) {
  if (method === "output.append") {
    const value = String(params.value ?? "").replace(/\n$/, "");
    if (value) set((s) => ({ logs: appendLog(s.logs, value) }));
    return;
  }
  if (method === "webview.registerProvider") {
    const viewId = String(params.viewId ?? "");
    if (!viewId) return;
    set((s) =>
      s.webviews.some((w) => w.viewId === viewId)
        ? {}
        : {
            webviews: [
              ...s.webviews,
              {
                viewId,
                html: null,
                resolving: false,
                error: null,
                runtimeErrors: [],
              },
            ],
            logs: appendLog(s.logs, `webview registered: ${viewId}`),
          },
    );
    return;
  }
  if (method === "webview.setHtml") {
    const viewId = String(params.viewId ?? "");
    const html = String(params.html ?? "");
    set((s) => ({
      webviews: s.webviews.map((w) =>
        w.viewId === viewId
          ? { ...w, html, resolving: false, error: null, runtimeErrors: [] }
          : w,
      ),
      logs: appendLog(
        s.logs,
        `webview painted: ${viewId} (${html.length} bytes)`,
      ),
    }));
    return;
  }
  if (method === "webview.postMessage") {
    // Delivered to the iframe by the component listening on this channel.
    window.dispatchEvent(
      new CustomEvent("dcode:webview-message", {
        detail: {
          viewId: String(params.viewId ?? ""),
          message: params.message,
        },
      }),
    );
    return;
  }
  if (method.startsWith("terminal.")) {
    const bridge = extTerminalBridge();
    const id = String(params.id ?? "");
    if (!bridge || !id) return;
    if (method === "terminal.create") {
      bridge.create(id, (params.options ?? {}) as ExtTerminalOptions);
      return;
    }
    if (method === "terminal.sendText") {
      const text = sanitizeTerminalText(String(params.text ?? ""));
      if (text === null) {
        set((s) => ({
          logs: appendLog(s.logs, `terminal.sendText refused for ${id}`),
        }));
        return;
      }
      bridge.sendText(id, text, params.addNewLine !== false);
      return;
    }
    if (method === "terminal.show") bridge.show(id);
    if (method === "terminal.dispose") bridge.dispose(id);
    return;
  }
  if (method === "webview.createPanel") {
    set((s) => ({
      logs: appendLog(
        s.logs,
        `webview panel requested: ${String(params.viewType)}`,
      ),
    }));
    return;
  }
  if (!method.startsWith("output.") && !method.startsWith("statusBar.")) {
    set((s) => ({ logs: appendLog(s.logs, `unhandled event: ${method}`) }));
  }
}

function handleRpc(
  id: number,
  method: string,
  params: Record<string, unknown>,
  get: () => State,
  set: (partial: (s: State) => Partial<State>) => void,
) {
  switch (method) {
    case "window.showMessage": {
      const message = String(params.message ?? "");
      const level = String(params.level ?? "info");
      if (level === "error") toast.error(message);
      else if (level === "warn") toast.warning(message);
      else toast.message(message);
      reply(id, null);
      break;
    }
    case "commands.execute":
      // `setContext` and friends have no app-side meaning yet; acknowledge so
      // the extension keeps going instead of awaiting forever.
      reply(id, null);
      break;
    case "env.openExternal": {
      const url = String(params.uri ?? "");
      // Only web and mail links; an extension must not be able to launch an
      // arbitrary protocol handler on the user's machine.
      if (!isExternalUrl(url)) {
        reply(id, false, `refused to open ${url}`);
        break;
      }
      void openExternalUrl(url).then(
        () => reply(id, true),
        (error) => reply(id, false, String(error)),
      );
      break;
    }
    case "secrets.get":
    case "secrets.store":
    case "secrets.delete": {
      const account = secretAccount(get().runningId, params.key);
      if (!account) {
        reply(id, null, "no running extension for this secret");
        break;
      }
      const done = (value: unknown) => reply(id, value);
      const failed = (error: unknown) => reply(id, null, String(error));
      if (method === "secrets.get") {
        void invoke<string | null>("secrets_get", {
          service: EXT_KEYRING_SERVICE,
          account,
        })
          .then((value) => done(value ?? undefined))
          .catch(() => done(undefined));
        break;
      }
      if (method === "secrets.store") {
        void invoke("secrets_set", {
          service: EXT_KEYRING_SERVICE,
          account,
          password: String(params.value ?? ""),
        })
          .then(() => done(null))
          .catch(failed);
        break;
      }
      void invoke("secrets_delete", { service: EXT_KEYRING_SERVICE, account })
        .then(() => done(null))
        .catch(() => done(null));
      break;
    }
    case "env.clipboardWrite":
      void navigator.clipboard
        .writeText(String(params.value ?? ""))
        .then(() => reply(id, null))
        .catch((error) => reply(id, null, String(error)));
      break;
    case "env.clipboardRead":
      void navigator.clipboard
        .readText()
        .then((text) => reply(id, text))
        .catch((error) => reply(id, null, String(error)));
      break;
    default:
      // An extension that stalls is usually waiting on an API we answer with
      // null, so every one of those is named in the log.
      set((s) => ({
        logs: appendLog(s.logs, `unimplemented API: ${method} (answered null)`),
      }));
      reply(id, null);
      break;
  }
}

/**
 * The last `setState` a webview published, kept outside the store: it is only
 * read when a frame is (re)built, and it must not re-render the panel.
 */
const webviewStates = new Map<string, unknown>();

export function rememberWebviewState(viewId: string, state: unknown): void {
  webviewStates.set(viewId, state);
}

export function webviewState(viewId: string): unknown {
  return webviewStates.get(viewId);
}
