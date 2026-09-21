import { describe, expect, it } from "vitest";
import {
  type CustomCommand,
  commandNameFromPath,
  expandCommandTemplate,
  mergeCommands,
  parseCommandFile,
  splitArguments,
} from "./customCommands";

describe("commandNameFromPath", () => {
  it("maps nested markdown files to namespaced names", () => {
    expect(commandNameFromPath("review.md")).toBe("review");
    expect(commandNameFromPath("git/PR.md")).toBe("git:pr");
    expect(commandNameFromPath("git\\pr.md")).toBe("git:pr");
  });

  it("rejects non-markdown and unusable names", () => {
    expect(commandNameFromPath("notes.txt")).toBeNull();
    expect(commandNameFromPath("my command.md")).toBeNull();
    expect(commandNameFromPath(".hidden.md")).toBeNull();
  });
});

describe("parseCommandFile", () => {
  it("reads frontmatter and strips it from the body", () => {
    const parsed = parseCommandFile(
      '---\r\ndescription: "Review the diff"\r\nargument-hint: [focus]\r\n---\r\nReview $ARGUMENTS\r\n',
    );
    expect(parsed).toEqual({
      description: "Review the diff",
      argumentHint: "[focus]",
      body: "Review $ARGUMENTS",
    });
  });

  it("falls back to the first line for the description", () => {
    expect(parseCommandFile("# Write tests\n\nFor $1").description).toBe(
      "Write tests",
    );
  });
});

describe("splitArguments", () => {
  it("groups quoted words", () => {
    expect(splitArguments('a "b c" d')).toEqual(["a", "b c", "d"]);
  });
});

describe("expandCommandTemplate", () => {
  it("substitutes all arguments and positionals", () => {
    expect(expandCommandTemplate("Fix $1 in $2: $ARGUMENTS", "bug src")).toBe(
      "Fix bug in src: bug src",
    );
  });

  it("blanks missing positionals", () => {
    expect(expandCommandTemplate("A $1 B $2", "x")).toBe("A x B ");
  });

  it("appends arguments when the template has no placeholder", () => {
    expect(expandCommandTemplate("Review.", "the api")).toBe(
      "Review.\n\nthe api",
    );
    expect(expandCommandTemplate("Review.", "")).toBe("Review.");
  });

  it("does not interpret replacement patterns in arguments", () => {
    expect(expandCommandTemplate("x $ARGUMENTS", "$& $1")).toBe("x $& $1");
  });
});

function cmd(name: string, source: "project" | "user"): CustomCommand {
  return {
    name,
    description: "",
    argumentHint: "",
    body: source,
    source,
    path: `/${source}/${name}.md`,
  };
}

describe("mergeCommands", () => {
  it("lets project commands shadow user ones regardless of order", () => {
    const merged = mergeCommands(new Set(), [
      [cmd("a", "user")],
      [cmd("a", "project"), cmd("b", "project")],
      [cmd("b", "user")],
    ]);
    expect(merged.map((c) => [c.name, c.source])).toEqual([
      ["a", "project"],
      ["b", "project"],
    ]);
  });

  it("never shadows built-ins", () => {
    expect(
      mergeCommands(new Set(["plan"]), [[cmd("plan", "project")]]),
    ).toEqual([]);
  });
});
