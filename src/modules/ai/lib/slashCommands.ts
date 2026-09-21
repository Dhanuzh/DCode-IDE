import {
  AiBrowserIcon,
  BubbleChatAddIcon,
  BookOpen01Icon,
  Bug01Icon,
  CheckListIcon,
  ClaudeIcon,
  CodeIcon,
  GitCommitIcon,
  SearchVisualIcon,
  SparklesIcon,
  TestTubeIcon,
} from "@hugeicons/core-free-icons";
import {
  isManagedAgentId,
  MANAGED_AGENT_IDS,
  type ManagedAgentId,
} from "@/modules/agents/lib/agentReadiness";
import { useChatStore } from "../store/chatStore";
import { usePlanStore } from "../store/planStore";
import { type CustomCommand, expandCommandTemplate } from "./customCommands";

/**
 * Outcome of intercepting a slash command from the composer.
 *
 * - `"handled"`: command ran; the composer should NOT send a chat message.
 * - `"send-prompt"`: replace the user's text with `prompt` and send normally.
 * - `"none"`: not a slash command; let the composer behave as usual.
 */
export type SlashOutcome =
  | { kind: "handled"; toast?: string }
  | { kind: "send-prompt"; prompt: string; commandName?: string }
  | { kind: "none" };

export type SlashCommandMeta = {
  name: string;
  invocation: string;
  label: string;
  description: string;
  argumentHint: string;
  icon: typeof SparklesIcon;
  source: "builtin" | CustomCommand["source"];
};

type BuiltinRun = (args: string) => SlashOutcome;

type Builtin = Omit<SlashCommandMeta, "invocation" | "source"> & {
  run: BuiltinRun;
};

function delegateDirective(agent: ManagedAgentId, request: string): string {
  return `The user wants to drive a coding agent (${agent}) through you. Their request:

<request>
${request}
</request>

You are the orchestrator, not the implementer. Do not write the code yourself.
1. Call read_agent_output to see whether a coding agent is already active in this session.
2. If none is active: turn the request into one clear, complete, self-contained prompt (state the concrete goal, relevant constraints, and what "done" looks like) and call spawn_coding_agent with it and agent "${agent}".
3. If one is active: read its latest output, then craft a precise follow-up and call send_to_agent.
Sharpen vague requests into precise engineering instructions; keep each agent prompt focused on one coherent unit of work.`;
}

/** `/delegate codex fix the flaky test` -> codex; no agent named -> claude. */
export function parseDelegateArgs(args: string): {
  agent: ManagedAgentId;
  request: string;
} {
  const match = args.match(/^(\S+)\s+([\s\S]+)$/);
  if (match && isManagedAgentId(match[1].toLowerCase())) {
    return {
      agent: match[1].toLowerCase() as ManagedAgentId,
      request: match[2].trim(),
    };
  }
  return { agent: "claude", request: args.trim() };
}

const INIT_PROMPT = `Scan this workspace and produce DCODE.md at the workspace root with:

- One-paragraph project description.
- Build / test / dev commands.
- Architecture overview (subsystems, data flow, key dirs).
- Conventions worth knowing (naming, patterns, gotchas).
- Paths to entry points.

Use grep/glob/list_directory/read_file to explore. Cap DCODE.md under 200 lines. Use write_file to create it (will go through normal approval).`;

function reviewPrompt(focus: string): string {
  return `Review the uncommitted changes in this workspace${focus ? `, focusing on: ${focus}` : ""}.

1. Use bash_run to run \`git status --short\` and \`git diff HEAD\`. These are read-only; do not stage, commit or modify anything.
2. Read surrounding code with read_file wherever the diff alone is not enough context.
3. Report findings ordered by severity: correctness bugs first, then security, performance and maintainability. For each give file:line, the problem, and a concrete fix.

Skip praise and style nits a formatter would catch. If the changes look correct, say so briefly.`;
}

function fixPrompt(hint: string): string {
  return `A command in my active terminal failed${hint ? ` (${hint})` : ""}.

1. Call get_terminal_output to read the recent output and identify the failing command and its error.
2. Find the root cause in the code or configuration, not just the symptom.
3. Make the smallest correct fix, then re-run the failing command with bash_run to verify it passes.`;
}

const COMMIT_PROMPT = `Write a commit message for the staged changes.

1. Use bash_run to run \`git diff --cached --stat\` and \`git diff --cached\`. If nothing is staged, say so and stop.
2. Match the repository's convention (check \`git log --oneline -10\`); default to Conventional Commits.
3. Reply with only the message in a code block: a subject under 72 characters, a blank line, then a short body explaining why when it is not obvious.

Do not run git commit.`;

function explainPrompt(target: string): string {
  return `Explain ${target || "the attached selection or file"}: what it does, how it fits into this codebase, and anything non-obvious (edge cases, invariants, gotchas). Read related code with read_file and grep as needed. Be concise.`;
}

function testPrompt(target: string): string {
  return `Write tests for ${target || "the code I attached or most recently changed"}.

1. Find the project's test framework, file layout and conventions (read nearby tests first) and follow them exactly.
2. Cover the main behavior, edge cases and failure modes; prefer testing pure logic.
3. Run the new tests with bash_run and fix failures until they pass.`;
}

function prompt(name: string, text: string): SlashOutcome {
  return { kind: "send-prompt", prompt: text, commandName: name };
}

const BUILTINS: Builtin[] = [
  {
    name: "init",
    label: "Initialize workspace",
    description: "Scan the project and write DCODE.md",
    argumentHint: "",
    icon: SparklesIcon,
    run: () => prompt("init", INIT_PROMPT),
  },
  {
    name: "plan",
    label: "Plan mode",
    description: "Queue edits for review instead of writing them",
    argumentHint: "[off]",
    icon: CheckListIcon,
    run: (args) => {
      const store = usePlanStore.getState();
      if (args === "off" || args === "exit") {
        store.disable();
        return { kind: "handled", toast: "Plan mode off" };
      }
      store.toggle();
      return {
        kind: "handled",
        toast: usePlanStore.getState().active
          ? "Plan mode on"
          : "Plan mode off",
      };
    },
  },
  {
    name: "review",
    label: "Review changes",
    description: "Review uncommitted changes for bugs",
    argumentHint: "[focus]",
    icon: SearchVisualIcon,
    run: (args) => prompt("review", reviewPrompt(args)),
  },
  {
    name: "fix",
    label: "Fix terminal error",
    description: "Diagnose and fix the last failing command",
    argumentHint: "[hint]",
    icon: Bug01Icon,
    run: (args) => prompt("fix", fixPrompt(args)),
  },
  {
    name: "commit",
    label: "Commit message",
    description: "Draft a message for the staged changes",
    argumentHint: "",
    icon: GitCommitIcon,
    run: () => prompt("commit", COMMIT_PROMPT),
  },
  {
    name: "explain",
    label: "Explain",
    description: "Explain code, a file or the attached selection",
    argumentHint: "[target]",
    icon: BookOpen01Icon,
    run: (args) => prompt("explain", explainPrompt(args)),
  },
  {
    name: "test",
    label: "Write tests",
    description: "Write and run tests following project conventions",
    argumentHint: "[target]",
    icon: TestTubeIcon,
    run: (args) => prompt("test", testPrompt(args)),
  },
  {
    name: "delegate",
    label: "Delegate to an agent",
    description: `Hand a task to a terminal coding agent (${MANAGED_AGENT_IDS.join(", ")})`,
    argumentHint: "[agent] <request>",
    icon: AiBrowserIcon,
    run: (args) => {
      const { agent, request } = parseDelegateArgs(args);
      return request
        ? prompt("delegate", delegateDirective(agent, request))
        : { kind: "handled", toast: "Usage: /delegate [agent] <request>" };
    },
  },
  {
    name: "claude-code",
    label: "Delegate to Claude Code",
    description: "Hand a task to a Claude Code agent",
    argumentHint: "<request>",
    icon: ClaudeIcon,
    run: (args) =>
      args
        ? prompt("claude-code", delegateDirective("claude", args))
        : { kind: "handled", toast: "Usage: /claude-code <request>" },
  },
  {
    name: "clear",
    label: "New chat",
    description: "Start a fresh chat session",
    argumentHint: "",
    icon: BubbleChatAddIcon,
    run: () => {
      useChatStore.getState().newSession();
      return { kind: "handled" };
    },
  },
];

const BUILTIN_BY_NAME = new Map(BUILTINS.map((b) => [b.name, b]));

export const RESERVED_COMMAND_NAMES: ReadonlySet<string> = new Set(
  BUILTIN_BY_NAME.keys(),
);

function builtinMeta(b: Builtin): SlashCommandMeta {
  const { run: _run, ...meta } = b;
  return { ...meta, invocation: `/${b.name}`, source: "builtin" };
}

export const SLASH_COMMANDS: Record<string, SlashCommandMeta> =
  Object.fromEntries(BUILTINS.map((b) => [b.name, builtinMeta(b)]));

export function customCommandMeta(cmd: CustomCommand): SlashCommandMeta {
  return {
    name: cmd.name,
    invocation: `/${cmd.name}`,
    label: cmd.name,
    description: cmd.description,
    argumentHint: cmd.argumentHint,
    icon: CodeIcon,
    source: cmd.source,
  };
}

/** Built-ins first, then custom commands. */
export function allCommandMetas(custom: CustomCommand[]): SlashCommandMeta[] {
  return [...Object.values(SLASH_COMMANDS), ...custom.map(customCommandMeta)];
}

export function findCommandMeta(
  name: string,
  custom: CustomCommand[],
): SlashCommandMeta | undefined {
  if (SLASH_COMMANDS[name]) return SLASH_COMMANDS[name];
  const hit = custom.find((c) => c.name === name);
  return hit ? customCommandMeta(hit) : undefined;
}

export const DCODE_CMD_RE =
  /^<dcode-command\s+name="([a-z0-9:_-]+)"(?:\s+state="([a-z]+)")?\s*\/>(?:\n+|$)/;

export function wrapWithCommandMarker(prompt: string, name: string): string {
  return `<dcode-command name="${name}" />\n\n${prompt}`;
}

export function tryRunSlashCommand(
  input: string,
  custom: CustomCommand[] = [],
): SlashOutcome {
  const trimmed = input.trim();
  const lead = trimmed[0];
  if (lead !== "/" && lead !== "#") return { kind: "none" };
  const match = trimmed.slice(1).match(/^(\S+)\s*([\s\S]*)$/);
  if (!match) return { kind: "none" };
  const head = match[1].toLowerCase();
  const tail = match[2].trim();

  const builtin = BUILTIN_BY_NAME.get(head);
  if (builtin) return builtin.run(tail);
  const cmd = custom.find((c) => c.name === head);
  if (cmd) return prompt(cmd.name, expandCommandTemplate(cmd.body, tail));
  return { kind: "none" };
}
