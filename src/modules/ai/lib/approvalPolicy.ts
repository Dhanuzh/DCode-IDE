/**
 * Tool approval policy. Decides whether a mutating tool call pauses for the
 * in-UI confirmation card or runs straight away.
 *
 * Policy lives in app settings keyed by workspace root, never in a file inside
 * the workspace: a cloned repository must not be able to grant itself
 * auto-approval. Auto-approval only skips the confirmation card; the path
 * deny-list and destructive-command guards in `security.ts` still run inside
 * every tool.
 */

export type ApprovalMode = "ask" | "auto-edits" | "auto-all";

export const APPROVAL_MODES: ApprovalMode[] = ["ask", "auto-edits", "auto-all"];

export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  ask: "Ask every time",
  "auto-edits": "Auto-approve edits",
  "auto-all": "Auto-approve everything",
};

export type ProjectApprovalRules = {
  /** Overrides the global mode for this project when set. */
  mode?: ApprovalMode;
  /** Tools always allowed in this project (edits stay inside its root). */
  trustedTools: string[];
  /** Shell command prefixes that run without asking. */
  allowedCommands: string[];
};

export type ApprovalSettings = {
  mode: ApprovalMode;
  projects: Record<string, ProjectApprovalRules>;
};

export const DEFAULT_APPROVAL_SETTINGS: ApprovalSettings = {
  mode: "ask",
  projects: {},
};

export const EDIT_TOOLS: ReadonlySet<string> = new Set([
  "write_file",
  "edit",
  "multi_edit",
  "create_directory",
]);

export const SHELL_TOOLS: ReadonlySet<string> = new Set([
  "bash_run",
  "bash_background",
]);

function isMode(value: unknown): value is ApprovalMode {
  return (
    typeof value === "string" && (APPROVAL_MODES as string[]).includes(value)
  );
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v !== "");
}

/** Defensive parse of the persisted value; anything malformed means "ask". */
export function coerceApprovalSettings(raw: unknown): ApprovalSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_APPROVAL_SETTINGS;
  const obj = raw as { mode?: unknown; projects?: unknown };
  const projects: Record<string, ProjectApprovalRules> = {};
  if (obj.projects && typeof obj.projects === "object") {
    for (const [key, value] of Object.entries(obj.projects)) {
      if (!value || typeof value !== "object") continue;
      const rules = value as Record<string, unknown>;
      projects[key] = {
        ...(isMode(rules.mode) ? { mode: rules.mode } : {}),
        trustedTools: stringList(rules.trustedTools),
        allowedCommands: stringList(rules.allowedCommands).filter(
          isSimpleCommand,
        ),
      };
    }
  }
  return { mode: isMode(obj.mode) ? obj.mode : "ask", projects };
}

function isWindowsPath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

/** Canonical key for a workspace root: forward slashes, no trailing slash. */
export function projectKey(root: string): string {
  let key = root.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (key.length > 1) key = key.replace(/\/+$/, "");
  return isWindowsPath(root) ? key.toLowerCase() : key;
}

/**
 * True when `path` names `root` or something below it. Paths with `.` or `..`
 * segments are never considered inside: the caller must not rely on lexical
 * normalization to decide what auto-runs.
 */
export function isInsideRoot(path: string, root: string): boolean {
  const segments = path.replace(/\\/g, "/").split("/");
  if (segments.some((s) => s === ".." || s === ".")) return false;
  const p = projectKey(path);
  const r = projectKey(root);
  if (isWindowsPath(path) !== isWindowsPath(root)) return false;
  if (r === "/") return p.startsWith("/");
  return p === r || p.startsWith(`${r}/`);
}

/**
 * A command that is one plain invocation: no chaining, pipes, redirection,
 * substitution or line breaks. Only these can match an allowed prefix, so
 * `pnpm test && curl ... | sh` never rides on a `pnpm test` rule.
 */
export function isSimpleCommand(command: string): boolean {
  const c = command.trim();
  if (!c) return false;
  return !/[;&|<>`\n\r]|\$\(|\$\{/.test(c);
}

export function commandMatchesPrefix(command: string, prefix: string): boolean {
  const c = command.trim().replace(/\s+/g, " ");
  const p = prefix.trim().replace(/\s+/g, " ");
  if (!p) return false;
  return c === p || c.startsWith(`${p} `);
}

const MULTI_WORD_TOOLS = new Set([
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "npx",
  "bunx",
  "cargo",
  "go",
  "git",
  "make",
  "just",
  "dotnet",
  "mvn",
  "gradle",
  "./gradlew",
  "uv",
  "poetry",
  "pip",
  "deno",
  "mix",
  "swift",
  "zig",
  "flutter",
  "dart",
  "composer",
  "bundle",
  "rake",
]);

// Subcommands that forward to an arbitrary script or package, so the rule
// must name the script too ("pnpm run build", not "pnpm run").
const FORWARDING_SUBCOMMANDS = new Set(["run", "exec", "x", "dlx", "tool"]);

// Commands too general to trust as a whole: interpreters, shells, privilege
// escalation, deletion, and anything that executes its arguments.
const NEVER_TRUST = new Set([
  "sudo",
  "su",
  "doas",
  "rm",
  "rmdir",
  "del",
  "dd",
  "chmod",
  "chown",
  "chgrp",
  "mv",
  "cp",
  "ln",
  "kill",
  "pkill",
  "killall",
  "xargs",
  "env",
  "nohup",
  "exec",
  "eval",
  "source",
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "ksh",
  "pwsh",
  "powershell",
  "cmd",
  "python",
  "python3",
  "node",
  "perl",
  "ruby",
  "php",
  "lua",
  "curl",
  "wget",
  "ssh",
  "scp",
  "rsync",
  "find",
  "awk",
  "sed",
  "tee",
  "docker",
  "podman",
  "kubectl",
]);

/**
 * The prefix an "always allow" rule for this command would store, or null
 * when the command is not safe to generalize.
 */
export function suggestCommandPrefix(command: string): string | null {
  if (!isSimpleCommand(command)) return null;
  const tokens = command.trim().split(/\s+/);
  const first = tokens[0];
  if (!first) return null;
  const bare = (first.split(/[\\/]/).pop() ?? first)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|com|ps1)$/, "");
  if (NEVER_TRUST.has(bare)) return null;
  if (!MULTI_WORD_TOOLS.has(first)) return first;
  const second = tokens[1];
  if (!second || second.startsWith("-")) return first;
  if (FORWARDING_SUBCOMMANDS.has(second)) {
    const third = tokens[2];
    if (!third || third.startsWith("-")) return null;
    return `${first} ${second} ${third}`;
  }
  return `${first} ${second}`;
}

export type ApprovalRequest = {
  toolName: string;
  input: unknown;
  settings: ApprovalSettings;
  workspaceRoot: string | null;
  /** Absolute path the tool will touch, for file tools. */
  resolvedPath: string | null;
};

export function rulesFor(
  settings: ApprovalSettings,
  workspaceRoot: string | null,
): ProjectApprovalRules | undefined {
  return workspaceRoot
    ? settings.projects[projectKey(workspaceRoot)]
    : undefined;
}

export function effectiveMode(
  settings: ApprovalSettings,
  workspaceRoot: string | null,
): ApprovalMode {
  return rulesFor(settings, workspaceRoot)?.mode ?? settings.mode;
}

/** Whether this tool call must pause for the user. */
export function needsApproval(req: ApprovalRequest): boolean {
  const rules = rulesFor(req.settings, req.workspaceRoot);
  const mode = rules?.mode ?? req.settings.mode;
  if (mode === "auto-all") return false;

  if (EDIT_TOOLS.has(req.toolName)) {
    const inside =
      req.workspaceRoot !== null &&
      req.resolvedPath !== null &&
      isInsideRoot(req.resolvedPath, req.workspaceRoot);
    if (!inside) return true;
    return !(
      mode === "auto-edits" || rules?.trustedTools.includes(req.toolName)
    );
  }

  if (SHELL_TOOLS.has(req.toolName)) {
    const command =
      req.input && typeof req.input === "object"
        ? (req.input as { command?: unknown }).command
        : undefined;
    if (typeof command !== "string" || !isSimpleCommand(command)) return true;
    return !rules?.allowedCommands.some((p) =>
      commandMatchesPrefix(command, p),
    );
  }

  return !rules?.trustedTools.includes(req.toolName);
}

/** Settings with one more rule for `workspaceRoot`, deduplicated. */
export function withProjectRule(
  settings: ApprovalSettings,
  workspaceRoot: string,
  rule: { tool: string } | { command: string },
): ApprovalSettings {
  const key = projectKey(workspaceRoot);
  const current = settings.projects[key] ?? {
    trustedTools: [],
    allowedCommands: [],
  };
  const next: ProjectApprovalRules =
    "tool" in rule
      ? {
          ...current,
          trustedTools: current.trustedTools.includes(rule.tool)
            ? current.trustedTools
            : [...current.trustedTools, rule.tool],
        }
      : {
          ...current,
          allowedCommands: current.allowedCommands.includes(rule.command)
            ? current.allowedCommands
            : [...current.allowedCommands, rule.command],
        };
  return { ...settings, projects: { ...settings.projects, [key]: next } };
}

/** Settings with the project's mode override set, or cleared when null. */
export function withProjectMode(
  settings: ApprovalSettings,
  workspaceRoot: string,
  mode: ApprovalMode | null,
): ApprovalSettings {
  const key = projectKey(workspaceRoot);
  const current = settings.projects[key] ?? {
    trustedTools: [],
    allowedCommands: [],
  };
  const { mode: _drop, ...rest } = current;
  const next: ProjectApprovalRules = mode ? { ...rest, mode } : rest;
  return { ...settings, projects: { ...settings.projects, [key]: next } };
}

/** Settings without the project's rules at all. */
export function withoutProject(
  settings: ApprovalSettings,
  key: string,
): ApprovalSettings {
  if (!(key in settings.projects)) return settings;
  const { [key]: _drop, ...projects } = settings.projects;
  return { ...settings, projects };
}

/**
 * The rule an "Always allow" click on this call's approval card would add, or
 * null when the call cannot be generalized safely.
 */
export function alwaysAllowRule(
  toolName: string,
  input: unknown,
): { tool: string } | { command: string } | null {
  if (SHELL_TOOLS.has(toolName)) {
    const command =
      input && typeof input === "object"
        ? (input as { command?: unknown }).command
        : undefined;
    if (typeof command !== "string") return null;
    const prefix = suggestCommandPrefix(command);
    return prefix ? { command: prefix } : null;
  }
  return { tool: toolName };
}

/** Settings with one rule removed from the project stored under `key`. */
export function withoutProjectRule(
  settings: ApprovalSettings,
  key: string,
  rule: { tool: string } | { command: string },
): ApprovalSettings {
  const current = settings.projects[key];
  if (!current) return settings;
  const next: ProjectApprovalRules =
    "tool" in rule
      ? {
          ...current,
          trustedTools: current.trustedTools.filter((t) => t !== rule.tool),
        }
      : {
          ...current,
          allowedCommands: current.allowedCommands.filter(
            (c) => c !== rule.command,
          ),
        };
  return { ...settings, projects: { ...settings.projects, [key]: next } };
}
