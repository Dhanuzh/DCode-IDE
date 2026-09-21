import { homeDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { CustomCommand } from "../lib/customCommands";
import {
  type CommandIo,
  commandDirs,
  discoverCommands,
} from "../lib/customCommandsLoader";
import { native } from "../lib/native";
import { RESERVED_COMMAND_NAMES } from "../lib/slashCommands";

// Re-reading a handful of small files is cheap, but opening the picker on
// every keystroke should not re-walk the disk.
const FRESH_MS = 5_000;

type State = {
  commands: CustomCommand[];
  refresh: (workspaceRoot: string | null) => Promise<void>;
};

async function readTextVia(
  read: (path: string) => Promise<{ kind: string; content?: string }>,
  path: string,
): Promise<string | null> {
  const r = await read(path);
  return r.kind === "text" && typeof r.content === "string" ? r.content : null;
}

// Project commands resolve through the active workspace env (WSL paths work);
// user commands always live on the host.
const projectIo: CommandIo = {
  readDir: (path) => native.readDir(path),
  readText: (path) => readTextVia(native.readFile, path),
};

const hostIo: CommandIo = {
  readDir: (path) => invoke("fs_read_dir", { path, showHidden: false }),
  readText: (path) =>
    readTextVia((p) => invoke("fs_read_file", { path: p }), path),
};

let home: string | null | undefined;
let lastKey: string | null = null;
let lastAt = 0;
let inflight: Promise<void> | null = null;

export const useCustomCommandsStore = create<State>((set) => ({
  commands: [],
  refresh: async (workspaceRoot) => {
    const key = workspaceRoot ?? "";
    if (key === lastKey && Date.now() - lastAt < FRESH_MS) return;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        if (home === undefined) {
          home = await homeDir()
            .then((h) => h.replace(/\\/g, "/"))
            .catch(() => null);
        }
        const dirs = commandDirs(workspaceRoot, home).map((d) => ({
          ...d,
          io: d.source === "project" ? projectIo : hostIo,
        }));
        const commands = await discoverCommands(dirs, RESERVED_COMMAND_NAMES);
        lastKey = key;
        lastAt = Date.now();
        set({ commands });
      } catch (error) {
        console.warn("[dcode] could not load custom commands:", error);
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },
}));
