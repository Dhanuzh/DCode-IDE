import { describe, expect, it } from "vitest";
import {
  type CommandDirEntry,
  type CommandIo,
  commandDirs,
  discoverCommands,
} from "./customCommandsLoader";

function fakeIo(files: Record<string, string>): CommandIo {
  return {
    readDir: async (path) => {
      const prefix = `${path}/`;
      const names = new Map<string, CommandDirEntry["kind"]>();
      for (const file of Object.keys(files)) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        const [head, ...tail] = rest.split("/");
        names.set(head, tail.length > 0 ? "dir" : "file");
      }
      if (names.size === 0) throw new Error("ENOENT");
      return [...names].map(([name, kind]) => ({ name, kind }));
    },
    readText: async (path) => files[path] ?? null,
  };
}

describe("commandDirs", () => {
  it("lists project dirs before user dirs", () => {
    expect(commandDirs("/w", "/h").map((d) => [d.path, d.source])).toEqual([
      ["/w/.dcode/commands", "project"],
      ["/w/.claude/commands", "project"],
      ["/h/.dcode/commands", "user"],
      ["/h/.claude/commands", "user"],
    ]);
    expect(commandDirs(null, null)).toEqual([]);
  });
});

describe("discoverCommands", () => {
  it("finds nested commands and applies precedence", async () => {
    const io = fakeIo({
      "/w/.dcode/commands/review.md":
        "---\ndescription: Project review\n---\nReview",
      "/w/.dcode/commands/git/pr.md": "Open a PR for $ARGUMENTS",
      "/w/.dcode/commands/notes.txt": "ignored",
      "/w/.dcode/commands/empty.md": "---\ndescription: x\n---\n",
      "/h/.dcode/commands/review.md": "User review",
      "/h/.dcode/commands/standup.md": "Standup",
      "/h/.dcode/commands/plan.md": "Shadow attempt",
    });
    const dirs = commandDirs("/w", "/h").map((d) => ({ ...d, io }));
    const commands = await discoverCommands(dirs, new Set(["plan"]));
    expect(commands.map((c) => [c.name, c.source, c.description])).toEqual([
      ["git:pr", "project", "Open a PR for $ARGUMENTS"],
      ["review", "project", "Project review"],
      ["standup", "user", "Standup"],
    ]);
  });

  it("skips oversized files", async () => {
    const io = fakeIo({ "/w/.dcode/commands/big.md": "x".repeat(70_000) });
    const dirs = commandDirs("/w", null).map((d) => ({ ...d, io }));
    expect(await discoverCommands(dirs, new Set())).toEqual([]);
  });
});
