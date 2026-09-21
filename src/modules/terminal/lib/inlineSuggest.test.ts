import type { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachInlineSuggest, inlineSuggestFor } from "./inlineSuggest";

const COLS = 40;

type Listener<T> = (value: T) => void;

function emitter<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    on: (fn: Listener<T>) => {
      listeners.add(fn);
      return { dispose: () => listeners.delete(fn) };
    },
    fire: (value: T) => {
      for (const fn of listeners) fn(value);
    },
  };
}

/** Just enough of xterm for the suggestion controller: one row of text. */
function fakeTerminal() {
  let row = "";
  let cursorX = 0;
  let osc: ((data: string) => boolean) | null = null;
  const data = emitter<string>();
  const written = emitter<void>();
  const decorations: { x: number; width: number }[] = [];
  const marker = () => ({ line: 0, isDisposed: false, dispose() {} });
  const term = {
    cols: COLS,
    options: { fontSize: 14, letterSpacing: 0, theme: {} },
    parser: {
      registerOscHandler: (_code: number, fn: (d: string) => boolean) => {
        osc = fn;
        return { dispose: () => {} };
      },
    },
    buffer: {
      active: {
        type: "normal",
        baseY: 0,
        cursorY: 0,
        get cursorX() {
          return cursorX;
        },
        getLine: (y: number) =>
          y === 0
            ? {
                isWrapped: false,
                translateToString: (trim = false, s = 0, e = COLS) => {
                  const t = row.padEnd(COLS, " ").slice(s, e);
                  return trim ? t.replace(/\s+$/, "") : t;
                },
              }
            : undefined,
      },
    },
    onData: data.on,
    onWriteParsed: written.on,
    onCursorMove: () => ({ dispose() {} }),
    onResize: () => ({ dispose() {} }),
    registerMarker: marker,
    registerDecoration: (opts: { x: number; width: number }) => {
      decorations.push(opts);
      return { onRender: () => {}, dispose() {} };
    },
  } as unknown as Terminal;

  return {
    term,
    decorations,
    prompt(text: string) {
      osc?.("A");
      osc?.("B");
      row = text;
      cursorX = text.length;
      written.fire();
    },
    type(text: string) {
      data.fire(text);
      row = row.slice(0, cursorX) + text + row.slice(cursorX + text.length);
      cursorX += text.length;
      written.fire();
    },
    /** Something drawn after the cursor without moving it. */
    paintAfterCursor(text: string) {
      row = row.slice(0, cursorX) + text;
      written.fire();
    },
    reply(text: string) {
      data.fire(text);
    },
    exec(payload?: string) {
      osc?.(payload === undefined ? "C" : `C;${payload}`);
    },
  };
}

async function settle() {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

function keydown(key: string, mods: Partial<KeyboardEvent> = {}) {
  return { type: "keydown", key, ...mods } as KeyboardEvent;
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(options: { enabled?: boolean; history?: string[] } = {}) {
  const fake = fakeTerminal();
  const history = options.history ?? ["git status", "git stash pop"];
  const deps = {
    suggest: vi.fn(
      async (typed: string) =>
        history.find((h) => h.startsWith(typed) && h.length > typed.length) ??
        null,
    ),
    record: vi.fn(),
    isEnabled: () => options.enabled ?? true,
    writeToPty: vi.fn(),
  };
  const dispose = attachInlineSuggest(fake.term, deps);
  return { ...fake, deps, dispose };
}

describe("attachInlineSuggest", () => {
  it("offers a history match after the typed text and accepts it with Right", async () => {
    const t = setup();
    t.prompt("~/proj $ ");
    t.type("git st");
    await settle();
    expect(t.deps.suggest).toHaveBeenLastCalledWith("git st");
    expect(t.decorations[t.decorations.length - 1]).toMatchObject({
      x: 15,
      width: 4,
    });

    const handled = inlineSuggestFor(t.term)?.handleKey(keydown("ArrowRight"));
    expect(handled).toBe(true);
    expect(t.deps.writeToPty).toHaveBeenCalledWith("atus");
    t.dispose();
  });

  it("lets Right through with modifiers or without a suggestion", async () => {
    const t = setup();
    t.prompt("$ ");
    t.type("zzz");
    await settle();
    const ctl = inlineSuggestFor(t.term);
    expect(ctl?.handleKey(keydown("ArrowRight"))).toBe(false);
    expect(ctl?.handleKey(keydown("ArrowRight", { shiftKey: true }))).toBe(
      false,
    );
    t.dispose();
  });

  it("stays out of the way when the shell draws its own suggestion", async () => {
    const t = setup();
    t.prompt("$ ");
    t.type("git st");
    t.paintAfterCursor("atus");
    await settle();
    expect(inlineSuggestFor(t.term)?.handleKey(keydown("ArrowRight"))).toBe(
      false,
    );
    t.dispose();
  });

  it("ignores terminal replies when finding where input starts", async () => {
    const t = setup();
    t.prompt("$ ");
    t.reply("\u001b[?1;2c");
    await settle();
    expect(t.deps.suggest).not.toHaveBeenCalled();
    t.dispose();
  });

  it("does nothing while disabled", async () => {
    const t = setup({ enabled: false });
    t.prompt("$ ");
    t.type("git st");
    await settle();
    expect(t.deps.suggest).not.toHaveBeenCalled();
    t.dispose();
  });

  it("records the executed command only when the shell's report matches", async () => {
    const t = setup();
    t.prompt("$ ");
    t.type("cargo test");
    await settle();
    t.exec("cargo test");
    expect(t.deps.record).toHaveBeenCalledWith("cargo test");

    t.prompt("$ ");
    t.type("ls");
    await settle();
    t.exec("rm -rf ~");
    expect(t.deps.record).toHaveBeenCalledTimes(1);

    t.prompt("$ ");
    t.type("make");
    await settle();
    t.exec();
    expect(t.deps.record).toHaveBeenLastCalledWith("make");
    t.dispose();
  });

  it("never records a command typed with a leading space", async () => {
    const t = setup();
    t.prompt("$ ");
    t.type(" secret");
    await settle();
    t.exec(" secret");
    expect(t.deps.record).not.toHaveBeenCalled();
    t.dispose();
  });

  it("forgets input after Ctrl+C", async () => {
    const t = setup();
    t.prompt("$ ");
    t.type("git st");
    await settle();
    t.reply("\u0003");
    await settle();
    expect(inlineSuggestFor(t.term)?.handleKey(keydown("ArrowRight"))).toBe(
      false,
    );
    t.dispose();
  });

  it("unregisters on dispose", () => {
    const t = setup();
    t.dispose();
    expect(inlineSuggestFor(t.term)).toBeUndefined();
  });
});
