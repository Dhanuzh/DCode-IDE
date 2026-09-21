/**
 * A small `.vimrc` for the editor's vim mode: key mappings and the handful of
 * options codemirror-vim understands. Parsing is pure so the settings UI can
 * report bad lines without touching the editor.
 */

export type VimMode = "normal" | "insert" | "visual";

export type VimrcCommand =
  | { kind: "map"; lhs: string; rhs: string; mode: VimMode; remap: boolean }
  | { kind: "unmap"; lhs: string; mode: VimMode }
  | { kind: "mapclear"; mode: VimMode | null }
  | { kind: "set"; name: string; value: string | boolean };

export type VimrcIssue = { line: number; text: string; reason: string };

export type ParsedVimrc = {
  commands: VimrcCommand[];
  issues: VimrcIssue[];
};

const MAP_COMMANDS: Record<string, { mode: VimMode; remap: boolean }> = {
  map: { mode: "normal", remap: true },
  noremap: { mode: "normal", remap: false },
  nmap: { mode: "normal", remap: true },
  nnoremap: { mode: "normal", remap: false },
  vmap: { mode: "visual", remap: true },
  vnoremap: { mode: "visual", remap: false },
  xmap: { mode: "visual", remap: true },
  xnoremap: { mode: "visual", remap: false },
  imap: { mode: "insert", remap: true },
  inoremap: { mode: "insert", remap: false },
};

const UNMAP_COMMANDS: Record<string, VimMode> = {
  unmap: "normal",
  nunmap: "normal",
  vunmap: "visual",
  xunmap: "visual",
  iunmap: "insert",
};

const MAPCLEAR_COMMANDS: Record<string, VimMode | null> = {
  mapclear: null,
  nmapclear: "normal",
  vmapclear: "visual",
  imapclear: "insert",
};

// Options codemirror-vim actually implements; anything else is reported
// instead of being silently ignored.
export const SUPPORTED_VIM_OPTIONS = [
  "ignorecase",
  "smartcase",
  "hlsearch",
  "incsearch",
  "wrap",
  "textwidth",
  "expandtab",
  "tabstop",
  "shiftwidth",
  "softtabstop",
  "number",
  "relativenumber",
  "clipboard",
  "timeout",
  "timeoutlen",
  "maxmapdepth",
] as const;

function parseSet(argument: string): VimrcCommand | string {
  const eq = argument.indexOf("=");
  if (eq !== -1) {
    const name = argument.slice(0, eq).trim();
    const value = argument.slice(eq + 1).trim();
    if (!SUPPORTED_VIM_OPTIONS.includes(name as never)) {
      return `unsupported option "${name}"`;
    }
    return { kind: "set", name, value };
  }
  let name = argument.trim();
  let value = true;
  if (name.endsWith("!")) return `toggling with ! is not supported`;
  if (name.startsWith("no")) {
    const bare = name.slice(2);
    if (SUPPORTED_VIM_OPTIONS.includes(bare as never)) {
      name = bare;
      value = false;
    }
  }
  if (!SUPPORTED_VIM_OPTIONS.includes(name as never)) {
    return `unsupported option "${name}"`;
  }
  return { kind: "set", name, value };
}

/** Parses a vimrc. Blank lines and `"`/`#` comments are skipped. */
export function parseVimrc(text: string): ParsedVimrc {
  const commands: VimrcCommand[] = [];
  const issues: VimrcIssue[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim().replace(/^:/, "");
    if (!line || line.startsWith('"') || line.startsWith("#")) continue;
    const fail = (reason: string) => {
      issues.push({ line: index + 1, text: raw.trim(), reason });
    };

    const [head, ...rest] = line.split(/\s+/);
    const keyword = head.toLowerCase();

    if (keyword === "set" || keyword === "se") {
      if (rest.length === 0) {
        fail("set needs an option");
        continue;
      }
      const parsed = parseSet(rest.join(" "));
      if (typeof parsed === "string") fail(parsed);
      else commands.push(parsed);
      continue;
    }
    if (keyword in MAPCLEAR_COMMANDS) {
      commands.push({ kind: "mapclear", mode: MAPCLEAR_COMMANDS[keyword] });
      continue;
    }
    if (keyword in UNMAP_COMMANDS) {
      if (rest.length !== 1) fail("unmap needs exactly one key");
      else {
        commands.push({
          kind: "unmap",
          lhs: rest[0],
          mode: UNMAP_COMMANDS[keyword],
        });
      }
      continue;
    }
    const map = MAP_COMMANDS[keyword];
    if (!map) {
      fail(`unknown command "${head}"`);
      continue;
    }
    if (rest.length < 2) {
      fail("a mapping needs keys and a target");
      continue;
    }
    commands.push({
      kind: "map",
      lhs: rest[0],
      // Everything after the keys is the target, spaces included.
      rhs: rest.slice(1).join(" "),
      mode: map.mode,
      remap: map.remap,
    });
  }

  return { commands, issues };
}

/** The subset of codemirror-vim's API the applier needs. */
export type VimApi = {
  map: (lhs: string, rhs: string, ctx: string) => void;
  noremap: (lhs: string, rhs: string, ctx: string) => void;
  unmap: (lhs: string, ctx: string) => unknown;
  mapclear: (ctx?: string) => void;
  // codemirror-vim reports a bad option by returning an Error.
  setOption: (name: string, value: never) => unknown;
};

/**
 * Applies parsed commands to the global vim state. Returns what failed, so a
 * bad mapping shows up in settings instead of vanishing.
 */
export function applyVimrc(
  vim: VimApi,
  commands: VimrcCommand[],
): { failures: string[] } {
  const failures: string[] = [];
  for (const command of commands) {
    try {
      switch (command.kind) {
        case "map":
          if (command.remap) vim.map(command.lhs, command.rhs, command.mode);
          else vim.noremap(command.lhs, command.rhs, command.mode);
          break;
        case "unmap":
          vim.unmap(command.lhs, command.mode);
          break;
        case "mapclear":
          vim.mapclear(command.mode ?? undefined);
          break;
        case "set": {
          const result = vim.setOption(command.name, command.value as never);
          if (result instanceof Error) failures.push(result.message);
          break;
        }
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { failures };
}

// Vim keeps mappings in module-global state, so the file only needs applying
// when its text changes, not once per editor pane.
let appliedVimrc: string | null = null;

/** Applies the user's vimrc once per distinct text. Returns any failures. */
export function syncVimrc(vim: VimApi, text: string): string[] {
  if (appliedVimrc === text) return [];
  appliedVimrc = text;
  vim.mapclear();
  const { commands } = parseVimrc(text);
  return applyVimrc(vim, commands).failures;
}

/** Test seam: forgets what was applied. */
export function resetVimrcCache(): void {
  appliedVimrc = null;
}
