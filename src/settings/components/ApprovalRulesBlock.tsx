import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  APPROVAL_MODE_LABELS,
  APPROVAL_MODES,
  type ApprovalMode,
  type ApprovalSettings,
  coerceApprovalSettings,
  withoutProject,
  withoutProjectRule,
} from "@/modules/ai/lib/approvalPolicy";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setAiApprovals } from "@/modules/settings/store";
import { Cancel01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

const MODE_HINT: Record<ApprovalMode, string> = {
  ask: "Every edit, command and agent launch shows a confirmation card.",
  "auto-edits":
    "File edits inside the open workspace run straight away; commands still ask.",
  "auto-all":
    "Nothing asks. Secret-path and destructive-command guards still apply.",
};

function save(next: ApprovalSettings) {
  void setAiApprovals(next).catch((error) =>
    console.warn("[dcode] could not save approval rules:", error),
  );
}

/** Settings block for the AI tool approval policy and per-project rules. */
export function ApprovalRulesBlock() {
  const settings = coerceApprovalSettings(
    usePreferencesStore((s) => s.aiApprovals),
  );
  const projects = Object.entries(settings.projects).filter(
    ([, rules]) =>
      rules.mode ||
      rules.trustedTools.length > 0 ||
      rules.allowedCommands.length > 0,
  );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col">
        <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
          Tool approvals
        </span>
        <span className="text-[10.5px] text-muted-foreground">
          Rules are stored with the app, never read from a project, so a cloned
          repository cannot approve its own commands.
        </span>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
        <span className="text-[12.5px] font-medium">Default</span>
        <div
          role="radiogroup"
          aria-label="Default approval mode"
          className="flex flex-wrap gap-1"
        >
          {APPROVAL_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={settings.mode === mode}
              onClick={() => save({ ...settings, mode })}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] transition-colors",
                settings.mode === mode
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-border/60 text-muted-foreground hover:text-foreground",
              )}
            >
              {APPROVAL_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        <span
          className={cn(
            "text-[10.5px] leading-relaxed text-muted-foreground",
            settings.mode === "auto-all" &&
              "text-amber-600 dark:text-amber-400",
          )}
        >
          {MODE_HINT[settings.mode]}
        </span>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-4 text-center text-[11px] text-muted-foreground">
          No project rules yet. Use "Always allow" on an approval card, or pick
          a mode for the current project from the AI input bar.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {projects.map(([key, rules]) => (
            <li
              key={key}
              className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[11px]"
                  title={key}
                >
                  {key}
                </span>
                {rules.mode ? (
                  <span
                    className={cn(
                      "shrink-0 rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground",
                      rules.mode === "auto-all" &&
                        "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {APPROVAL_MODE_LABELS[rules.mode]}
                  </span>
                ) : null}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground hover:text-destructive"
                  onClick={() => save(withoutProject(settings, key))}
                  title="Forget all rules for this project"
                  aria-label="Forget all rules for this project"
                >
                  <HugeiconsIcon
                    icon={Delete02Icon}
                    size={12}
                    strokeWidth={1.75}
                  />
                </Button>
              </div>
              {rules.trustedTools.length > 0 ||
              rules.allowedCommands.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {rules.trustedTools.map((tool) => (
                    <RuleChip
                      key={`t:${tool}`}
                      label={tool}
                      onRemove={() =>
                        save(withoutProjectRule(settings, key, { tool }))
                      }
                    />
                  ))}
                  {rules.allowedCommands.map((command) => (
                    <RuleChip
                      key={`c:${command}`}
                      label={`$ ${command}`}
                      onRemove={() =>
                        save(withoutProjectRule(settings, key, { command }))
                      }
                    />
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RuleChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-muted/50 py-0.5 pr-0.5 pl-1.5 font-mono text-[10.5px] text-muted-foreground">
      {label}
      <button
        type="button"
        onClick={onRemove}
        title="Remove rule"
        aria-label={`Remove rule ${label}`}
        className="rounded p-0.5 hover:bg-accent hover:text-foreground"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2} />
      </button>
    </span>
  );
}
