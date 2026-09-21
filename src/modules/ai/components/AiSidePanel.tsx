import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextTrigger,
} from "@/components/ai-elements/context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useChat, type UIMessage } from "@ai-sdk/react";
import {
  Add01Icon,
  AlertCircleIcon,
  ArrowUpIcon,
  Cancel01Icon,
  Clock01Icon,
  Delete02Icon,
  FilterIcon,
  Mic01Icon,
  StopCircleIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useRef } from "react";
import {
  estimateCost,
  getModel,
  getModelContextLimit,
  STT_PROVIDER_LABELS,
  type ModelId,
} from "../config";
import { ACCEPTED_FILES, useComposer } from "../lib/composer";
import type { SessionMeta } from "../lib/sessions";
import { useChatStore } from "../store/chatStore";
import { getOrCreateChat } from "../store/chatRuntime";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { usePlanStore } from "../store/planStore";
import { AiChatView } from "./AiChat";
import { AiComposerInput } from "./AiComposerInput";
import { ModelDropdown } from "./AiStatusBarControls";
import { ChipsRow } from "./ChipsRow";
import { PlanDiffReview } from "./PlanDiffReview";
import { TodoStrip } from "./TodoStrip";

const SUGGESTIONS = [
  {
    label: "Explain the last error",
    hint: "Read the terminal buffer",
    icon: AlertCircleIcon,
    text: "Explain the last error in the terminal.",
  },
  {
    label: "Generate a command",
    hint: "Tell me what you want to do",
    icon: TerminalIcon,
    text: "Give me a command to ",
  },
  {
    label: "Summarize buffer",
    hint: "Recap recent activity",
    icon: FilterIcon,
    text: "Summarize what just happened in the terminal.",
  },
];

export function AiSidePanel() {
  const closeDock = useChatStore((s) => s.closeDock);
  const sessionId = useChatStore((s) => s.activeSessionId);

  return (
    <div
      data-ai-dock
      className="no-scrollbar-deep flex h-full min-h-0 flex-col overflow-hidden border-l border-border/60 bg-card text-[12px]"
    >
      {sessionId ? (
        <Body sessionId={sessionId} onClose={closeDock} />
      ) : (
        <>
          <Header step={null} isBusy={false} onClose={closeDock} />
          <div className="flex flex-1 items-center justify-center text-[11px] text-muted-foreground">
            Loading sessions…
          </div>
        </>
      )}
      <PlanDiffReview />
    </div>
  );
}

function Body({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const focusInput = useChatStore((s) => s.focusInput);
  const step = useChatStore((s) => s.agentMeta.step);

  const chat = useMemo(() => getOrCreateChat(sessionId), [sessionId]);
  const helpers = useChat<UIMessage>({ chat });
  const isBusy =
    helpers.status === "submitted" || helpers.status === "streaming";

  return (
    <>
      <Header
        step={step}
        isBusy={isBusy}
        onClose={onClose}
        messages={helpers.messages}
      />

      <PlanModeStrip />

      <div className="flex min-h-0 flex-1 flex-col">
        {helpers.messages.length === 0 ? (
          <EmptyState onPick={focusInput} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col [&_.text-sm]:text-[12px] [&_p]:leading-relaxed">
            <AiChatView
              messages={helpers.messages}
              status={helpers.status}
              error={helpers.error}
              clearError={helpers.clearError}
              addToolApprovalResponse={helpers.addToolApprovalResponse}
              stop={helpers.stop}
            />
          </div>
        )}
      </div>

      <TodoStrip sessionId={sessionId} />
      <DockComposer />
    </>
  );
}

function PlanModeStrip() {
  const active = usePlanStore((s) => s.active);
  const queueLen = usePlanStore((s) => s.queue.length);
  const disable = usePlanStore((s) => s.disable);
  if (!active) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/40 bg-muted/40 px-3 py-1.5">
      <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
      <span className="text-[11px] font-medium text-foreground">Plan mode</span>
      <span className="text-[11px] text-muted-foreground">
        {queueLen > 0 ? `· ${queueLen} queued` : "· no edits queued"}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={() => disable()}
        className="rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        Exit
      </button>
    </div>
  );
}

function Header({
  step,
  isBusy,
  onClose,
  messages,
}: {
  step: string | null;
  isBusy: boolean;
  onClose: () => void;
  messages?: UIMessage[];
}) {
  const newSession = useChatStore((s) => s.newSession);

  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/60 px-2">
      <span className="shrink-0 text-[11px] font-semibold tracking-wide text-foreground/90">
        Agent
      </span>
      {isBusy ? (
        <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
          <Spinner className="size-2.5" />
          <span className="truncate">{step ?? "Thinking…"}</span>
        </span>
      ) : null}
      <span className="min-w-0 flex-1" />
      {messages !== undefined ? <ContextIndicator messages={messages} /> : null}
      <HeaderBtn title="New session" onClick={() => newSession()}>
        <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={1.75} />
      </HeaderBtn>
      <SessionPicker />
      <HeaderBtn title="Close AI sidebar" onClick={onClose}>
        <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
      </HeaderBtn>
    </div>
  );
}

function HeaderBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={onClick}
      className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
      aria-label={title}
      title={title}
    >
      {children}
    </Button>
  );
}

function DockComposer() {
  const c = useComposer();
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="shrink-0 border-t border-border/60 bg-card px-2.5 pt-2 pb-1.5">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(e) => {
          void c.addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div
        className={cn(
          "flex flex-col gap-1.5 rounded-xl border border-border/70 bg-muted/25 px-2.5 py-2",
          "transition-colors focus-within:border-border focus-within:bg-muted/40",
        )}
      >
        <ChipsRow
          files={c.files}
          onRemoveFile={c.removeFile}
          snippets={c.pickedSnippets}
          onRemoveSnippet={(id) => {
            const snip = c.pickedSnippets.find((s) => s.id === id);
            c.removeSnippet(id);
            if (!snip) return;
            const re = new RegExp(`(^|\\s)#${snip.handle}\\b ?`);
            c.setValue((v) => v.replace(re, (_m, lead: string) => lead));
          }}
          commands={c.pickedCommands}
          onRemoveCommand={(name) => c.removeCommand(name)}
        />

        <AiComposerInput />

        <div className="flex items-center gap-0.5">
          <ComposerBtn
            title="Attach file or image"
            onClick={() => fileInputRef.current?.click()}
            disabled={c.isBusy}
          >
            <HugeiconsIcon icon={Add01Icon} size={13} strokeWidth={2} />
          </ComposerBtn>

          <ModelDropdown />

          <span className="min-w-0 flex-1" />

          {c.voice.supported && (
            <ComposerBtn
              title={
                !c.voice.hasKey
                  ? `Voice needs a ${STT_PROVIDER_LABELS[c.voice.sttProvider]} key`
                  : c.voice.recording
                    ? "Stop & transcribe"
                    : c.voice.transcribing
                      ? "Transcribing…"
                      : "Voice input"
              }
              onClick={() =>
                c.voice.recording ? c.voice.stop() : void c.voice.start()
              }
              disabled={c.isBusy || c.voice.transcribing || !c.voice.hasKey}
              className={cn(
                c.voice.recording &&
                  "bg-destructive/10 text-destructive hover:bg-destructive/15",
              )}
            >
              {c.voice.recording ? (
                <span className="size-2 animate-pulse rounded-full bg-destructive" />
              ) : c.voice.transcribing ? (
                <Spinner className="size-3" />
              ) : (
                <HugeiconsIcon icon={Mic01Icon} size={13} strokeWidth={1.75} />
              )}
            </ComposerBtn>
          )}

          {c.isBusy ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={c.stop}
              className="size-6"
              aria-label="Stop"
              title="Stop"
            >
              <HugeiconsIcon
                icon={StopCircleIcon}
                size={13}
                strokeWidth={1.75}
              />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={c.submit}
              disabled={!c.canSend}
              className="size-6 rounded-full"
              aria-label="Send"
              title="Send (Enter)"
            >
              <HugeiconsIcon icon={ArrowUpIcon} size={13} strokeWidth={2} />
            </Button>
          )}
        </div>
      </div>

      <p className="px-1 pt-1.5 text-center text-[10px] text-muted-foreground/70">
        AI may make mistakes. Review generated code and commands.
      </p>
    </div>
  );
}

function ComposerBtn({
  title,
  onClick,
  disabled,
  className,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "size-6 text-muted-foreground hover:text-foreground",
        className,
      )}
      aria-label={title}
      title={title}
    >
      {children}
    </Button>
  );
}

function estimateTokens(messages: UIMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === "text") {
        chars += (p as { text?: string }).text?.length ?? 0;
      } else if (p.type === "reasoning") {
        chars += (p as { text?: string }).text?.length ?? 0;
      } else if (typeof p.type === "string" && p.type.startsWith("tool-")) {
        const tp = p as unknown as { input?: unknown; output?: unknown };
        if (tp.input) chars += JSON.stringify(tp.input).length;
        if (tp.output) chars += JSON.stringify(tp.output).length;
      }
    }
  }
  return Math.ceil(chars / 4);
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function ContextIndicator({ messages }: { messages: UIMessage[] }) {
  const modelId = useChatStore((s) => s.selectedModelId);
  const tokens = useChatStore((s) => s.agentMeta.tokens);
  const lastInput = useChatStore((s) => s.agentMeta.lastInputTokens);
  const lastCached = useChatStore((s) => s.agentMeta.lastCachedTokens);
  const estimated = useMemo(() => estimateTokens(messages), [messages]);
  const used = lastInput > 0 ? lastInput : estimated;
  const reported = tokens.inputTokens + tokens.outputTokens;
  const openaiCompatibleContextLimit = usePreferencesStore(
    (s) => s.openaiCompatibleContextLimit,
  );
  const max = getModelContextLimit(modelId, openaiCompatibleContextLimit);
  const modelLabel = useMemo(() => {
    try {
      return getModel(modelId as ModelId).label;
    } catch {
      return modelId;
    }
  }, [modelId]);
  const cost = estimateCost(modelId, tokens);
  const cacheRate =
    tokens.inputTokens > 0
      ? Math.round((tokens.cachedInputTokens / tokens.inputTokens) * 100)
      : 0;

  return (
    <Context usedTokens={used} maxTokens={max}>
      <ContextTrigger className="h-6 gap-1 px-1 text-[10.5px]" />
      <ContextContent className="w-64 text-[11px]">
        <ContextContentHeader />
        <ContextContentBody>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Model</span>
            <span className="font-mono text-foreground">{modelLabel}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-muted-foreground">
            <span>{lastInput > 0 ? "Last request" : "Estimated context"}</span>
            <span className="font-mono text-foreground">
              {formatTokens(used)}
            </span>
          </div>
          {lastCached > 0 && (
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Of which cached</span>
              <span className="font-mono text-foreground">
                {formatTokens(lastCached)}
              </span>
            </div>
          )}
          {reported > 0 && (
            <>
              <div className="mt-1.5 flex items-center justify-between text-muted-foreground">
                <span>Session input</span>
                <span className="font-mono text-foreground">
                  {formatTokens(tokens.inputTokens)}
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Session output</span>
                <span className="font-mono text-foreground">
                  {formatTokens(tokens.outputTokens)}
                </span>
              </div>
              {tokens.cachedInputTokens > 0 && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Cache hit</span>
                  <span className="font-mono text-foreground">
                    {cacheRate}%
                  </span>
                </div>
              )}
              {cost != null && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Session cost</span>
                  <span className="font-mono text-foreground">
                    ${cost.toFixed(cost < 0.01 ? 4 : cost < 1 ? 3 : 2)}
                  </span>
                </div>
              )}
            </>
          )}
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Window</span>
            <span className="font-mono text-foreground">
              {formatTokens(max)}
            </span>
          </div>
        </ContextContentBody>
        <ContextContentFooter>
          <span className="text-[10px] italic text-muted-foreground">
            {lastInput > 0
              ? "Last request reflects current context size; session totals are cumulative."
              : "Token count is approximate (chars / 4)."}
          </span>
        </ContextContentFooter>
      </ContextContent>
    </Context>
  );
}

function SessionPicker() {
  const sessions = useChatStore((s) => s.sessions);
  const activeId = useChatStore((s) => s.activeSessionId);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Session history"
          title="Session history"
        >
          <HugeiconsIcon icon={Clock01Icon} size={13} strokeWidth={1.75} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuItem
          onSelect={() => newSession()}
          className="gap-2 text-xs"
        >
          <HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.75} />
          New session
        </DropdownMenuItem>
        {sorted.length > 0 ? <DropdownMenuSeparator /> : null}
        {sorted.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            active={s.id === activeId}
            onSelect={() => switchSession(s.id)}
            onDelete={() => deleteSession(s.id)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SessionRow({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: SessionMeta;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        // Don't dismiss if user clicked the trash icon — handle below.
        const target = e.target as HTMLElement | null;
        if (target?.closest("[data-session-delete]")) {
          e.preventDefault();
          return;
        }
        onSelect();
      }}
      className={cn(
        "group flex items-center justify-between gap-2 text-xs",
        active && "bg-accent/40",
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        {session.title || "New chat"}
      </span>
      <button
        type="button"
        data-session-delete
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete session"
        className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
      >
        <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={1.75} />
      </button>
    </DropdownMenuItem>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <img src="/logo.png" alt="DCode-IDE" className="size-12 opacity-90" />
      <div className="space-y-1.5">
        <p className="text-[13.5px] font-semibold tracking-tight">
          Ask DCode anything
        </p>
        <p className="max-w-[18rem] text-[11.5px] leading-relaxed text-muted-foreground">
          DCode sees the active terminal — cwd, recent commands, and output.
        </p>
      </div>
      <div className="flex w-full flex-col gap-2.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onPick(s.text)}
            className={cn(
              "group flex items-center gap-2.5 bg-card/70 rounded-lg px-2.5 py-2 border border-border text-left",
              "transition-colors hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground transition-colors group-hover:bg-foreground/5 group-hover:text-foreground">
              <HugeiconsIcon icon={s.icon} size={13} strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-foreground">
                {s.label}
              </div>
              <div className="text-[10.5px] text-muted-foreground">
                {s.hint}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
