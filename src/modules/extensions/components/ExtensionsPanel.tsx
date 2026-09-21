import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { DEFAULT_THEME_ID, useTheme } from "@/modules/theme";
import {
  Alert02Icon,
  Delete02Icon,
  Download04Icon,
  Image01Icon,
  PaintBoardIcon,
  PlayIcon,
  PuzzleIcon,
  Search01Icon,
  StopIcon,
  StarIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useChatStore } from "@/modules/ai";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ExtSummary, InstalledExt, SearchScope } from "../lib/native";
import { pickThemeForMode, themeIdFor } from "../lib/vscodeTheme";
import { useExtHostStore } from "../host/extHostStore";
import { summaryId, useExtensionsStore } from "../store/extensionsStore";

const SEARCH_DEBOUNCE_MS = 350;

export function ExtensionsPanel() {
  const refreshHostStatus = useExtHostStore((s) => s.refreshStatus);
  const hydrated = useExtensionsStore((s) => s.hydrated);
  const hydrate = useExtensionsStore((s) => s.hydrate);
  const query = useExtensionsStore((s) => s.query);
  const setQuery = useExtensionsStore((s) => s.setQuery);
  const search = useExtensionsStore((s) => s.search);
  const searching = useExtensionsStore((s) => s.searching);
  const results = useExtensionsStore((s) => s.results);
  const scope = useExtensionsStore((s) => s.scope);
  const setScope = useExtensionsStore((s) => s.setScope);
  const installed = useExtensionsStore((s) => s.installed);
  const error = useExtensionsStore((s) => s.error);

  useEffect(() => {
    if (!hydrated) void hydrate();
    void refreshHostStatus();
  }, [hydrated, hydrate, refreshHostStatus]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      void search("");
      return;
    }
    const timer = window.setTimeout(
      () => void search(trimmed),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [query, search]);

  const installedIds = useMemo(
    () => new Set(installed.map((e) => e.id)),
    [installed],
  );
  const browsing = query.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-2 py-2">
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            strokeWidth={1.75}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Open VSX"
            spellCheck={false}
            className="h-7 pl-7 text-[12px]"
          />
          {searching ? (
            <Spinner className="absolute right-2 top-1/2 size-3 -translate-y-1/2" />
          ) : null}
        </div>

        {browsing ? (
          <div className="mt-1.5 flex items-center gap-1">
            <ScopeButton
              scope="themes"
              active={scope === "themes"}
              label="Themes & icons"
              onSelect={setScope}
            />
            <ScopeButton
              scope="all"
              active={scope === "all"}
              label="All"
              onSelect={setScope}
            />
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mx-2 mb-2 flex shrink-0 items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          <HugeiconsIcon
            icon={Alert02Icon}
            size={12}
            strokeWidth={1.75}
            className="mt-px shrink-0"
          />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {browsing ? (
          <Section
            label={searching ? "Searching…" : `Results (${results.length})`}
          >
            {results.map((summary) => (
              <ResultRow
                key={summaryId(summary)}
                summary={summary}
                installed={installedIds.has(summaryId(summary))}
              />
            ))}
            {!searching && results.length === 0 ? (
              <Empty
                text={
                  scope === "themes"
                    ? "No themes matched. Switch to All to search every extension."
                    : "No extensions matched."
                }
              />
            ) : null}
          </Section>
        ) : (
          <Section label={`Installed (${installed.length})`}>
            {installed.map((extension) => (
              <InstalledRow key={extension.id} extension={extension} />
            ))}
            {hydrated && installed.length === 0 ? (
              <Empty text="Search Open VSX to install themes and icon packs." />
            ) : null}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="px-1 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="px-1 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
      {text}
    </p>
  );
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className="size-9 shrink-0 rounded-md object-cover"
      />
    );
  }
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-[13px] font-semibold text-muted-foreground">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function ResultRow({
  summary,
  installed,
}: {
  summary: ExtSummary;
  installed: boolean;
}) {
  const install = useExtensionsStore((s) => s.install);
  const busy = useExtensionsStore((s) => s.busy.includes(summaryId(summary)));
  const applyIcons = useExtensionsStore((s) => s.applyIcons);
  const { resolvedMode, setThemeId } = useTheme();

  const installAndApply = async () => {
    const themes = await install(summary);
    const extension = useExtensionsStore
      .getState()
      .installed.find((e) => e.id === summaryId(summary));
    const iconTheme = extension?.iconThemes[0];
    if (extension && iconTheme) {
      await applyIcons(extension, iconTheme, resolvedMode);
      toast.success(`Applied ${iconTheme.label}`);
    }

    const picked = pickThemeForMode(themes, resolvedMode);
    if (!picked) return;
    setThemeId(picked.id);
    toast.success(`Applied ${picked.name}`, {
      description:
        themes.length > 1
          ? `${themes.length - 1} more variant${themes.length > 2 ? "s" : ""} available below`
          : undefined,
    });
  };

  return (
    <Row
      icon={<Avatar src={summary.iconUrl} name={summary.displayName} />}
      title={summary.displayName}
      subtitle={summary.namespace}
      description={summary.description}
      meta={
        <>
          <span className="flex items-center gap-1">
            <HugeiconsIcon icon={Download04Icon} size={11} strokeWidth={1.75} />
            {formatCount(summary.downloadCount)}
          </span>
          {summary.averageRating != null ? (
            <span className="flex items-center gap-1">
              <HugeiconsIcon icon={StarIcon} size={11} strokeWidth={1.75} />
              {summary.averageRating.toFixed(1)}
            </span>
          ) : null}
          <span className="font-mono">{summary.version}</span>
        </>
      }
      action={
        <Button
          size="xs"
          variant={installed ? "outline" : "default"}
          disabled={busy || installed}
          onClick={() => void installAndApply()}
          className="h-6 px-2 text-[11px]"
        >
          {busy ? (
            <Spinner className="size-3" />
          ) : installed ? (
            "Installed"
          ) : (
            "Install"
          )}
        </Button>
      }
    />
  );
}

function InstalledRow({ extension }: { extension: InstalledExt }) {
  const remove = useExtensionsStore((s) => s.remove);
  const busy = useExtensionsStore((s) => s.busy.includes(extension.id));
  const applyIcons = useExtensionsStore((s) => s.applyIcons);
  const clearIcons = useExtensionsStore((s) => s.clearIcons);
  const activeIconTheme = useExtensionsStore((s) => s.activeIconTheme);
  const { themeId, setThemeId, resolvedMode } = useTheme();
  const hostPhase = useExtHostStore((s) => s.phase);
  const hostRunningId = useExtHostStore((s) => s.runningId);
  const hostStatus = useExtHostStore((s) => s.status);
  const hostLogs = useExtHostStore((s) => s.logs);
  const hostError = useExtHostStore((s) => s.error);
  const runHost = useExtHostStore((s) => s.run);
  const stopHost = useExtHostStore((s) => s.stop);
  const workspaceRoot = useChatStore((s) => s.live.getWorkspaceRoot());
  const running = hostRunningId === extension.id && hostPhase !== "idle";

  const removeAndRestore = async () => {
    const contributed = extension.themes.map((c) =>
      themeIdFor(extension.id, c.label),
    );
    await remove(extension.id);
    // The active theme just went away; fall back instead of leaving a dead id.
    if (contributed.includes(themeId)) setThemeId(DEFAULT_THEME_ID);
  };

  const iconSrc = extension.iconPath
    ? convertFileSrc(extension.iconPath)
    : null;
  const unsupported = extension.hasCode || extension.grammarCount > 0;

  return (
    <Row
      icon={<Avatar src={iconSrc} name={extension.displayName} />}
      title={extension.displayName}
      subtitle={extension.publisher || extension.id}
      description={extension.description}
      meta={<span className="font-mono">{extension.version}</span>}
      action={
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() => void removeAndRestore()}
          className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
          title="Uninstall"
          aria-label={`Uninstall ${extension.displayName}`}
        >
          {busy ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
          )}
        </Button>
      }
      footer={
        <>
          {extension.themes.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {extension.themes.map((contribution) => {
                const id = themeIdFor(extension.id, contribution.label);
                const active = themeId === id;
                return (
                  <Chip
                    key={id}
                    icon={PaintBoardIcon}
                    active={active}
                    label={contribution.label}
                    onClick={() => setThemeId(id)}
                  />
                );
              })}
            </div>
          ) : null}
          {extension.iconThemes.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {extension.iconThemes.map((contribution) => {
                const active =
                  activeIconTheme?.extensionId === extension.id &&
                  activeIconTheme.iconThemeId === contribution.id;
                return (
                  <Chip
                    key={contribution.id}
                    icon={Image01Icon}
                    active={active}
                    label={contribution.label}
                    onClick={() =>
                      active
                        ? clearIcons()
                        : void applyIcons(extension, contribution, resolvedMode)
                    }
                  />
                );
              })}
            </div>
          ) : null}
          {extension.hasCode ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={hostStatus ? !hostStatus.available : false}
                  onClick={() =>
                    running
                      ? void stopHost()
                      : void runHost(extension, workspaceRoot)
                  }
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] transition-colors",
                    running
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground",
                    "disabled:opacity-50",
                  )}
                  title={hostStatus?.detail}
                >
                  <HugeiconsIcon
                    icon={running ? StopIcon : PlayIcon}
                    size={10}
                    strokeWidth={1.75}
                  />
                  {running ? "Stop" : "Run"}
                </button>
                {running ? (
                  <span className="text-[10px] text-muted-foreground">
                    {hostPhase === "activated"
                      ? "activated"
                      : hostPhase === "failed"
                        ? "failed"
                        : hostPhase}
                  </span>
                ) : null}
              </div>
              {running && (hostLogs.length > 0 || hostError) ? (
                <pre className="max-h-28 overflow-auto rounded border border-border/50 bg-muted/30 p-1.5 text-[9.5px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                  {hostError ?? hostLogs.slice(-12).join("\n")}
                </pre>
              ) : null}
            </div>
          ) : null}
          {unsupported && !extension.hasCode ? (
            <p className="text-[10px] leading-relaxed text-muted-foreground/80">
              Colors and icons apply. Grammars need more of the extension host.
            </p>
          ) : null}
        </>
      }
    />
  );
}

function Row({
  icon,
  title,
  subtitle,
  description,
  meta,
  action,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  meta: React.ReactNode;
  action: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-transparent px-1.5 py-2 transition-colors hover:border-border/60 hover:bg-accent/30">
      <div className="flex items-start gap-2">
        {icon}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
              {title}
            </span>
            {action}
          </div>
          <span className="truncate text-[10.5px] text-muted-foreground">
            {subtitle}
          </span>
          {description ? (
            <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
          <div className="flex items-center gap-2.5 pt-0.5 text-[10px] text-muted-foreground/80">
            {meta}
          </div>
        </div>
      </div>
      {footer ? (
        <div className="flex flex-col gap-1 pl-11">{footer}</div>
      ) : null}
    </div>
  );
}

export function ExtensionsRailIcon() {
  return <HugeiconsIcon icon={PuzzleIcon} size={14} strokeWidth={1.75} />;
}

function Chip({
  icon,
  label,
  active,
  onClick,
}: {
  icon: typeof PaintBoardIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] transition-colors",
        active
          ? "border-primary/50 bg-primary/10 text-foreground"
          : "border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <HugeiconsIcon icon={icon} size={10} strokeWidth={1.75} />
      {label}
    </button>
  );
}

function ScopeButton({
  scope,
  active,
  label,
  onSelect,
}: {
  scope: SearchScope;
  active: boolean;
  label: string;
  onSelect: (scope: SearchScope) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(scope)}
      aria-pressed={active}
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[10.5px] transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
