import type { UIMessage } from "@ai-sdk/react";
import { invoke } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";
import { compactTranscript } from "./transcript";

export type SessionMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

// The store file only holds the session index. Transcripts live in one file
// per session (Rust `ai_sessions`), so saving one chat never re-serializes
// every other chat's history.
const STORE_PATH = "dcode-ai-sessions.json";
const KEY_SESSIONS = "sessions";
const KEY_ACTIVE = "activeId";
const LEGACY_MESSAGES_PREFIX = "messages:";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: 200 });

export type LoadedSessions = {
  sessions: SessionMeta[];
  activeId: string | null;
};

// Writes and deletes for one session run strictly in order: a slow earlier
// save must never land after (and overwrite) a newer one.
const queues = new Map<string, Promise<void>>();

function enqueue(id: string, job: () => Promise<void>): Promise<void> {
  const prev = queues.get(id) ?? Promise.resolve();
  const next = prev.then(job).catch((error) => {
    console.warn(`[dcode] ai session ${id} persistence failed:`, error);
  });
  queues.set(id, next);
  void next.then(() => {
    if (queues.get(id) === next) queues.delete(id);
  });
  return next;
}

function writeTranscript(id: string, messages: UIMessage[]): Promise<void> {
  const json = JSON.stringify(compactTranscript(messages));
  return invoke<void>("ai_session_write", { id, json });
}

async function migrateLegacyTranscripts(
  legacy: [string, UIMessage[]][],
): Promise<void> {
  // Never let a stale legacy copy overwrite a transcript that was already
  // migrated (and possibly extended) by an earlier run.
  const existing = new Set(await invoke<string[]>("ai_session_list"));
  for (const [id, messages] of legacy) {
    try {
      if (!existing.has(id) && Array.isArray(messages)) {
        await writeTranscript(id, messages);
      }
      await store.delete(`${LEGACY_MESSAGES_PREFIX}${id}`);
    } catch (error) {
      console.warn(`[dcode] could not migrate ai session ${id}:`, error);
    }
  }
  await store.save();
}

export async function loadAll(): Promise<LoadedSessions> {
  // One IPC roundtrip via entries() rather than two parallel get()s.
  const entries = await store.entries();
  let sessions: SessionMeta[] | undefined;
  let activeId: string | null | undefined;
  const legacy: [string, UIMessage[]][] = [];
  for (const [k, v] of entries) {
    if (k === KEY_SESSIONS) sessions = v as SessionMeta[];
    else if (k === KEY_ACTIVE) activeId = v as string | null;
    else if (k.startsWith(LEGACY_MESSAGES_PREFIX)) {
      legacy.push([k.slice(LEGACY_MESSAGES_PREFIX.length), v as UIMessage[]]);
    }
  }
  if (legacy.length > 0) {
    try {
      await migrateLegacyTranscripts(legacy);
    } catch (error) {
      console.warn("[dcode] ai session migration deferred:", error);
    }
  }
  return { sessions: sessions ?? [], activeId: activeId ?? null };
}

export async function loadMessages(id: string): Promise<UIMessage[] | null> {
  await queues.get(id);
  try {
    const json = await invoke<string | null>("ai_session_read", { id });
    if (!json) return null;
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as UIMessage[]) : null;
  } catch (error) {
    console.warn(`[dcode] could not read ai session ${id}:`, error);
    return null;
  }
}

export async function saveSessionsList(sessions: SessionMeta[]): Promise<void> {
  await store.set(KEY_SESSIONS, sessions);
}

export async function saveActiveId(id: string | null): Promise<void> {
  await store.set(KEY_ACTIVE, id);
}

export function saveMessages(id: string, messages: UIMessage[]): Promise<void> {
  return enqueue(id, () => writeTranscript(id, messages));
}

export function deleteSessionData(id: string): Promise<void> {
  return enqueue(id, () => invoke<void>("ai_session_delete", { id }));
}

export function newSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveTitle(messages: UIMessage[]): string {
  for (const m of messages) {
    if (m.role !== "user") continue;
    for (const p of m.parts) {
      if (p.type !== "text") continue;
      const text = (p as { text: string }).text
        .replace(/<terminal-context[\s\S]*?<\/terminal-context>\s*/g, "")
        .replace(/<selection[\s\S]*?<\/selection>\s*/g, "")
        .replace(/<file[\s\S]*?<\/file>\s*/g, "")
        .trim();
      if (!text) continue;
      const first = text.split("\n")[0].trim();
      return first.length > 40 ? `${first.slice(0, 40)}…` : first;
    }
  }
  return "New chat";
}
