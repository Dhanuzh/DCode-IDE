/**
 * User-defined slash commands: markdown prompt templates discovered on disk.
 *
 *   <workspace>/.dcode/commands/review.md   -> /review        (project)
 *   <workspace>/.dcode/commands/git/pr.md   -> /git:pr        (project)
 *   ~/.dcode/commands/standup.md            -> /standup       (user)
 *
 * `.claude/commands` is read too, so existing Claude Code commands work
 * unchanged. A file may start with a frontmatter block:
 *
 *   ---
 *   description: Review the current diff
 *   argument-hint: [focus area]
 *   ---
 *
 * The body is the prompt. `$ARGUMENTS` expands to everything typed after the
 * command, `$1`..`$9` to individual arguments ("double quotes" group words).
 */

export type CommandSource = "project" | "user";

export type CustomCommand = {
  name: string;
  description: string;
  argumentHint: string;
  body: string;
  source: CommandSource;
  path: string;
};

export const MAX_COMMAND_FILE_BYTES = 64 * 1024;
export const MAX_CUSTOM_COMMANDS = 200;

const NAME_RE = /^[a-z0-9][a-z0-9_-]*(:[a-z0-9][a-z0-9_-]*)*$/;

export function isValidCommandName(name: string): boolean {
  return name.length <= 64 && NAME_RE.test(name);
}

/** `git/pr.md` -> `git:pr`; null for non-markdown or unusable names. */
export function commandNameFromPath(relPath: string): string | null {
  const normalized = relPath.replace(/\\/g, "/");
  if (!/\.md$/i.test(normalized)) return null;
  const name = normalized
    .replace(/\.md$/i, "")
    .split("/")
    .filter(Boolean)
    .join(":")
    .toLowerCase();
  return isValidCommandName(name) ? name : null;
}

export function parseCommandFile(text: string): {
  description: string;
  argumentHint: string;
  body: string;
} {
  const normalized = text.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  let body = normalized;
  const meta: Record<string, string> = {};
  const fm = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (fm) {
    body = normalized.slice(fm[0].length);
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      meta[m[1].toLowerCase()] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  body = body.trim();
  const firstLine = body.split("\n").find((l) => l.trim()) ?? "";
  return {
    description:
      meta.description ??
      firstLine
        .replace(/^#+\s*/, "")
        .slice(0, 100)
        .trim(),
    argumentHint: meta["argument-hint"] ?? "",
    body,
  };
}

/** Whitespace-separated arguments; "double quotes" keep words together. */
export function splitArguments(args: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  for (const m of args.matchAll(re)) out.push(m[1] ?? m[2]);
  return out;
}

export function expandCommandTemplate(body: string, args: string): string {
  const trimmedArgs = args.trim();
  const positional = splitArguments(trimmedArgs);
  let used = false;
  const expanded = body.replace(/\$(ARGUMENTS|[1-9])/g, (_, key: string) => {
    used = true;
    if (key === "ARGUMENTS") return trimmedArgs;
    return positional[Number(key) - 1] ?? "";
  });
  if (!used && trimmedArgs) return `${expanded}\n\n${trimmedArgs}`;
  return expanded;
}

/**
 * Final command list: project commands shadow user commands of the same
 * name, and nothing may shadow a built-in.
 */
export function mergeCommands(
  reserved: ReadonlySet<string>,
  lists: CustomCommand[][],
): CustomCommand[] {
  const byName = new Map<string, CustomCommand>();
  for (const list of lists) {
    for (const cmd of list) {
      if (reserved.has(cmd.name)) continue;
      const existing = byName.get(cmd.name);
      if (existing && existing.source === "project") continue;
      byName.set(cmd.name, cmd);
    }
  }
  return [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_CUSTOM_COMMANDS);
}
