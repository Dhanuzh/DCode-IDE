/**
 * SSH targets typed by the user or read from ~/.ssh/config. A target becomes
 * a command line written into a shell, so every part is validated against a
 * strict charset instead of being quoted: nothing that could start an option
 * (`-oProxyCommand=...`) or break out of the command survives.
 */

export type SshTarget = {
  user: string | null;
  host: string;
  port: number | null;
};

const USER_RE = /^[A-Za-z0-9._-]{1,64}$/;
const HOST_RE = /^[A-Za-z0-9._-]{1,253}$/;
const IPV6_RE = /^[0-9A-Fa-f:.]{2,45}$/;

function validHost(host: string): boolean {
  if (host.startsWith("-") || host.startsWith(".")) return false;
  return HOST_RE.test(host);
}

function validPort(raw: string): number | null {
  if (!/^\d{1,5}$/.test(raw)) return null;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : null;
}

/**
 * Accepts `host`, `user@host`, `host:port`, `user@host:port`, `[v6]:port`
 * and the same behind an `ssh://` prefix. Null when anything is off.
 */
export function parseSshTarget(input: string): SshTarget | null {
  let s = input.trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith("ssh://")) s = s.slice(6).replace(/\/$/, "");
  if (/\s/.test(s)) return null;

  let user: string | null = null;
  const at = s.lastIndexOf("@");
  if (at !== -1) {
    user = s.slice(0, at);
    s = s.slice(at + 1);
    if (!USER_RE.test(user) || user.startsWith("-")) return null;
  }

  let port: number | null = null;
  let host: string;
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end === -1) return null;
    host = s.slice(1, end);
    const rest = s.slice(end + 1);
    if (!IPV6_RE.test(host)) return null;
    if (rest) {
      if (!rest.startsWith(":")) return null;
      port = validPort(rest.slice(1));
      if (port === null) return null;
    }
    return { user, host: `[${host}]`, port };
  }

  const colon = s.indexOf(":");
  if (colon !== -1) {
    port = validPort(s.slice(colon + 1));
    if (port === null) return null;
    host = s.slice(0, colon);
  } else {
    host = s;
  }
  if (!validHost(host)) return null;
  return { user, host, port };
}

/** Canonical display / storage form: `user@host:port`. */
export function formatSshTarget(t: SshTarget): string {
  const base = t.user ? `${t.user}@${t.host}` : t.host;
  return t.port && t.port !== 22 ? `${base}:${t.port}` : base;
}

/** The command written into the new tab's shell. */
export function buildSshCommand(t: SshTarget): string {
  const host = t.host.startsWith("[") ? t.host.slice(1, -1) : t.host;
  const dest = t.user ? `${t.user}@${host}` : host;
  return t.port && t.port !== 22 ? `ssh -p ${t.port} ${dest}` : `ssh ${dest}`;
}

const MAX_RECENTS = 12;

/** Most recent first, deduplicated, capped. */
export function pushRecent(recents: string[], target: string): string[] {
  return [target, ...recents.filter((r) => r !== target)].slice(0, MAX_RECENTS);
}
