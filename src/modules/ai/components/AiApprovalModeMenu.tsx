import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setAiApprovals } from "@/modules/settings/store";
import {
  Alert02Icon,
  SecurityCheckIcon,
  Settings01Icon,
  ShieldKeyIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  APPROVAL_MODE_LABELS,
  APPROVAL_MODES,
  type ApprovalMode,
  coerceApprovalSettings,
  rulesFor,
  withProjectMode,
} from "../lib/approvalPolicy";
import { useChatStore } from "../store/chatStore";

const SHORT_LABEL: Record<ApprovalMode, string> = {
  ask: "Ask",
  "auto-edits": "Auto-edit",
  "auto-all": "Auto",
};

const ICON = {
  ask: ShieldKeyIcon,
  "auto-edits": SecurityCheckIcon,
  "auto-all": Alert02Icon,
} as const;

const USE_DEFAULT = "default";

/** Composer control for how tool calls are approved in this workspace. */
export function AiApprovalModeMenu() {
  const settings = coerceApprovalSettings(
    usePreferencesStore((s) => s.aiApprovals),
  );
  const workspaceRoot = useChatStore((s) => s.live).getWorkspaceRoot();
  const override = rulesFor(settings, workspaceRoot)?.mode ?? null;
  const mode = override ?? settings.mode;

  const choose = (value: string) => {
    const picked = value === USE_DEFAULT ? null : (value as ApprovalMode);
    const next = workspaceRoot
      ? withProjectMode(settings, workspaceRoot, picked)
      : { ...settings, mode: picked ?? "ask" };
    void setAiApprovals(next).catch((error) =>
      console.warn("[dcode] could not save approval mode:", error),
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          title={`Tool approvals: ${APPROVAL_MODE_LABELS[mode]}`}
          aria-label={`Tool approvals: ${APPROVAL_MODE_LABELS[mode]}`}
          className={cn(
            "h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground",
            mode === "auto-all" && "text-amber-600 dark:text-amber-400",
          )}
        >
          <HugeiconsIcon icon={ICON[mode]} size={12} strokeWidth={1.75} />
          {SHORT_LABEL[mode]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-60">
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">
          {workspaceRoot ? "Tool approvals in this project" : "Tool approvals"}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={workspaceRoot ? (override ?? USE_DEFAULT) : settings.mode}
          onValueChange={choose}
        >
          {workspaceRoot ? (
            <DropdownMenuRadioItem value={USE_DEFAULT} className="text-xs">
              Default ({APPROVAL_MODE_LABELS[settings.mode].toLowerCase()})
            </DropdownMenuRadioItem>
          ) : null}
          {APPROVAL_MODES.map((m) => (
            <DropdownMenuRadioItem key={m} value={m} className="text-xs">
              {APPROVAL_MODE_LABELS[m]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {mode === "auto-all" ? (
          <p className="px-2 pb-1.5 text-[10.5px] leading-snug text-amber-600 dark:text-amber-400">
            Commands and edits run without a confirmation card. Secret-path and
            destructive-command guards still apply.
          </p>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-xs"
          onSelect={() => void openSettingsWindow("agents")}
        >
          <HugeiconsIcon icon={Settings01Icon} size={12} strokeWidth={1.75} />
          Manage rules
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
