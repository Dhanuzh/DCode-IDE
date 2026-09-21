import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Clock01Icon, ServerStack01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  formatSshTarget,
  parseSshTarget,
  pushRecent,
  type SshTarget,
} from "./lib/target";

type ConfigHost = {
  alias: string;
  hostname: string | null;
  user: string | null;
  port: number | null;
};

const RECENTS_KEY = "dcode.ssh.recents";

function readRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (r): r is string => typeof r === "string" && !!parseSshTarget(r),
        )
      : [];
  } catch {
    return [];
  }
}

function writeRecents(recents: string[]): void {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  } catch {
    // storage may fail in private mode
  }
}

function hostDetail(h: ConfigHost): string | null {
  if (!h.hostname && !h.user && !h.port) return null;
  const host = h.hostname ?? h.alias;
  const base = h.user ? `${h.user}@${host}` : host;
  return h.port && h.port !== 22 ? `${base}:${h.port}` : base;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (target: SshTarget) => void;
};

/**
 * Pick or type an SSH destination. The connection runs the system `ssh`
 * client in a new terminal tab, so keys, agents, passwords and host-key
 * prompts are handled by ssh itself.
 */
export function SshConnectDialog({ open, onOpenChange, onConnect }: Props) {
  const [query, setQuery] = useState("");
  const [hosts, setHosts] = useState<ConfigHost[]>([]);
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setRecents(readRecents());
    let cancelled = false;
    invoke<ConfigHost[]>("ssh_config_hosts")
      .then((list) => {
        if (!cancelled) setHosts(list.filter((h) => parseSshTarget(h.alias)));
      })
      .catch(() => {
        if (!cancelled) setHosts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const typed = parseSshTarget(query);
  const typedLabel = typed ? formatSshTarget(typed) : null;
  const known = new Set([...recents, ...hosts.map((h) => h.alias)]);

  const connect = (target: SshTarget) => {
    const next = pushRecent(recents, formatSshTarget(target));
    writeRecents(next);
    setRecents(next);
    onOpenChange(false);
    onConnect(target);
  };

  const connectTo = (raw: string) => {
    const target = parseSshTarget(raw);
    if (target) connect(target);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Connect via SSH"
      description="Open an SSH session in a new terminal tab"
    >
      <Command>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="user@host:port, or a host from ~/.ssh/config"
        />
        <CommandList>
          <CommandEmpty>
            {query.trim()
              ? "Not a valid SSH destination."
              : "Type user@host to connect."}
          </CommandEmpty>
          {typed && typedLabel && !known.has(typedLabel) ? (
            <CommandGroup heading="Connect">
              <CommandItem
                value={`connect ${query}`}
                onSelect={() => connect(typed)}
              >
                <HugeiconsIcon
                  icon={ServerStack01Icon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="flex-1 truncate">
                  ssh <span className="font-mono">{typedLabel}</span>
                </span>
              </CommandItem>
            </CommandGroup>
          ) : null}
          {recents.length > 0 ? (
            <CommandGroup heading="Recent">
              {recents.map((r) => (
                <CommandItem
                  key={`r:${r}`}
                  value={`recent ${r}`}
                  onSelect={() => connectTo(r)}
                >
                  <HugeiconsIcon
                    icon={Clock01Icon}
                    size={14}
                    strokeWidth={1.75}
                  />
                  <span className="flex-1 truncate font-mono">{r}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {hosts.length > 0 ? (
            <CommandGroup heading="~/.ssh/config">
              {hosts.map((h) => {
                const detail = hostDetail(h);
                return (
                  <CommandItem
                    key={`h:${h.alias}`}
                    value={`host ${h.alias} ${detail ?? ""}`}
                    onSelect={() => connectTo(h.alias)}
                  >
                    <HugeiconsIcon
                      icon={ServerStack01Icon}
                      size={14}
                      strokeWidth={1.75}
                    />
                    <span className="flex-1 truncate font-mono">{h.alias}</span>
                    {detail ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {detail}
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
