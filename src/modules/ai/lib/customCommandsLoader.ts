import {
  type CommandSource,
  type CustomCommand,
  commandNameFromPath,
  MAX_COMMAND_FILE_BYTES,
  MAX_CUSTOM_COMMANDS,
  mergeCommands,
  parseCommandFile,
} from "./customCommands";

export type CommandDirEntry = {
  name: string;
  kind: "file" | "dir" | "symlink";
};

export type CommandIo = {
  readDir: (path: string) => Promise<CommandDirEntry[]>;
  /** File text, or null when missing, binary or over the size cap. */
  readText: (path: string) => Promise<string | null>;
};

export type CommandDir = { path: string; source: CommandSource; io: CommandIo };

const MAX_DEPTH = 3;

function join(dir: string, name: string): string {
  return dir.endsWith("/") || dir.endsWith("\\")
    ? `${dir}${name}`
    : `${dir}/${name}`;
}

/** Command directories for a workspace, most specific first. */
export function commandDirs(
  workspaceRoot: string | null,
  home: string | null,
): { path: string; source: CommandSource }[] {
  const dirs: { path: string; source: CommandSource }[] = [];
  if (workspaceRoot) {
    dirs.push({
      path: join(workspaceRoot, ".dcode/commands"),
      source: "project",
    });
    dirs.push({
      path: join(workspaceRoot, ".claude/commands"),
      source: "project",
    });
  }
  if (home) {
    dirs.push({ path: join(home, ".dcode/commands"), source: "user" });
    dirs.push({ path: join(home, ".claude/commands"), source: "user" });
  }
  return dirs;
}

async function collect(
  dir: CommandDir,
  rel: string,
  depth: number,
  out: CustomCommand[],
): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_CUSTOM_COMMANDS) return;
  const abs = rel ? join(dir.path, rel) : dir.path;
  let entries: CommandDirEntry[];
  try {
    entries = await dir.io.readDir(abs);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_CUSTOM_COMMANDS) return;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.kind === "dir") {
      await collect(dir, childRel, depth + 1, out);
      continue;
    }
    if (entry.kind !== "file") continue;
    const name = commandNameFromPath(childRel);
    if (!name) continue;
    const path = join(dir.path, childRel);
    let text: string | null;
    try {
      text = await dir.io.readText(path);
    } catch {
      continue;
    }
    if (text === null || text.length > MAX_COMMAND_FILE_BYTES) continue;
    const parsed = parseCommandFile(text);
    if (!parsed.body) continue;
    out.push({ name, ...parsed, source: dir.source, path });
  }
}

/** Reads every command directory; missing directories are simply skipped. */
export async function discoverCommands(
  dirs: CommandDir[],
  reserved: ReadonlySet<string>,
): Promise<CustomCommand[]> {
  const lists = await Promise.all(
    dirs.map(async (dir) => {
      const out: CustomCommand[] = [];
      await collect(dir, "", 0, out);
      return out;
    }),
  );
  return mergeCommands(reserved, lists);
}
