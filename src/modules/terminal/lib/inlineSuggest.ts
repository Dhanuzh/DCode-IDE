import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";
import {
  type CellPos,
  fitGhost,
  ghostFor,
  isRecordableCommand,
  readPromptInput,
} from "./inlineSuggestModel";

export type InlineSuggestDeps = {
  suggest: (typed: string) => Promise<string | null>;
  record: (command: string) => void;
  isEnabled: () => boolean;
  writeToPty: (data: string) => void;
};

type Ghost = {
  full: string;
  typed: string;
  at: CellPos;
  marker: IMarker;
  deco: IDecoration;
};

type Controller = {
  /** True when the key accepted a suggestion and must not reach the shell. */
  handleKey: (event: KeyboardEvent) => boolean;
};

const controllers = new WeakMap<Terminal, Controller>();

export function inlineSuggestFor(term: Terminal): Controller | undefined {
  return controllers.get(term);
}

// Keys that begin prompt input. Terminal replies (DA, focus, color queries)
// also arrive through onData and must not be mistaken for typing.
const INPUT_START_RE = /^(?:[^\x00-\x1f\x7f]|\t|\x1b(?:\[|O)[A-D]|\x1b\[200~)/;

/**
 * Fish-style history suggestions for a plain (non-block) terminal: dim ghost
 * text after the cursor at the shell prompt, accepted with Right or End.
 *
 * Shell integration marks the prompt (OSC 133 A/B/D) and the start of a
 * command (C) but not where typing begins, so input start is taken from the
 * cursor at the first keystroke after the prompt. When the shell already draws
 * its own suggestion (fish, zsh-autosuggestions, PSReadLine) the cells after
 * the cursor are not blank and nothing is shown.
 */
export function attachInlineSuggest(
  term: Terminal,
  deps: InlineSuggestDeps,
): () => void {
  let atPrompt = false;
  let start: { marker: IMarker; x: number } | null = null;
  let ghost: Ghost | null = null;
  let lastInput: string | null = null;
  let token = 0;
  let raf: number | null = null;
  let disposed = false;
  let cache: { typed: string; answer: string | null } | null = null;

  const buffer = () => term.buffer.active;
  const cursorPos = (): CellPos => ({
    line: buffer().baseY + buffer().cursorY,
    x: buffer().cursorX,
  });

  const clearGhost = () => {
    if (!ghost) return;
    ghost.deco.dispose();
    ghost.marker.dispose();
    ghost = null;
  };

  const resetInput = () => {
    token++;
    start?.marker.dispose();
    start = null;
    lastInput = null;
    clearGhost();
  };

  const recordCommand = (payload: string | null) => {
    // Only the tail is trimmed: a leading space is how the user asks shells
    // to keep a command out of history.
    const typed = lastInput?.replace(/\s+$/, "") ?? null;
    if (!typed || !isRecordableCommand(typed)) return;
    // zsh, fish and pwsh report the command; accept it only when it matches
    // what was typed here, so output from a background job cannot plant
    // entries in history.
    if (payload !== null && payload.replace(/\s+$/, "") !== typed) return;
    deps.record(typed);
    cache = null;
  };

  const osc = term.parser.registerOscHandler(133, (data) => {
    const kind = data[0];
    if (kind === "C") {
      if (atPrompt) {
        const payload = data.startsWith("C;") ? data.slice(2) : null;
        recordCommand(payload);
      }
      atPrompt = false;
      resetInput();
    } else if (kind === "A" || kind === "B" || kind === "D") {
      atPrompt = true;
      resetInput();
    }
    // Let the prompt tracker see every marker too.
    return false;
  });

  const dataSub = term.onData((data) => {
    if (!atPrompt) return;
    if (data.includes("\x03") || data.includes("\x0c")) {
      resetInput();
      return;
    }
    if (start || buffer().type !== "normal") return;
    if (!INPUT_START_RE.test(data)) return;
    const marker = term.registerMarker(0);
    if (marker) start = { marker, x: buffer().cursorX };
  });

  const render = (full: string, shown: string, typed: string, at: CellPos) => {
    const marker = term.registerMarker(0);
    if (!marker) return;
    const deco = term.registerDecoration({
      marker,
      x: at.x,
      width: shown.length,
      layer: "top",
    });
    if (!deco) {
      marker.dispose();
      return;
    }
    deco.onRender((el) => {
      if (el.dataset.ghost === shown) return;
      el.dataset.ghost = shown;
      el.textContent = shown;
      el.className = "dcode-inline-suggest";
      el.style.fontFamily = term.options.fontFamily ?? "";
      el.style.fontSize = `${term.options.fontSize ?? 14}px`;
      el.style.letterSpacing = `${term.options.letterSpacing ?? 0}px`;
      el.style.lineHeight = el.style.height;
      el.style.color = term.options.theme?.foreground ?? "";
    });
    ghost = { full, typed, at, marker, deco };
  };

  const update = async () => {
    if (
      disposed ||
      !atPrompt ||
      !start ||
      start.marker.isDisposed ||
      buffer().type !== "normal"
    ) {
      clearGhost();
      return;
    }
    const at = cursorPos();
    const input = readPromptInput(
      buffer(),
      { line: start.marker.line, x: start.x },
      at,
      term.cols,
    );
    if (!input) {
      clearGhost();
      return;
    }
    lastInput = input.blankAfter > 0 ? input.typed : null;
    if (
      ghost &&
      ghost.typed === input.typed &&
      ghost.at.line === at.line &&
      ghost.at.x === at.x
    ) {
      return;
    }
    clearGhost();
    if (!deps.isEnabled() || input.blankAfter === 0 || !input.typed.trim()) {
      return;
    }
    const mine = ++token;
    let answer: string | null;
    if (cache?.typed === input.typed) {
      answer = cache.answer;
    } else {
      answer = await deps.suggest(input.typed);
      if (mine !== token || disposed) return;
      cache = { typed: input.typed, answer };
    }
    const now = cursorPos();
    if (now.line !== at.line || now.x !== at.x) return;
    const full = ghostFor(input.typed, answer);
    if (!full) return;
    const shown = fitGhost(full, input.blankAfter, at.x, term.cols);
    if (!shown) return;
    render(full, shown, input.typed, at);
  };

  const schedule = () => {
    if (disposed || raf !== null) return;
    if (!atPrompt || !start) {
      clearGhost();
      return;
    }
    raf = requestAnimationFrame(() => {
      raf = null;
      void update();
    });
  };

  const writeSub = term.onWriteParsed(schedule);
  const cursorSub = term.onCursorMove(schedule);
  const resizeSub = term.onResize(() => clearGhost());

  controllers.set(term, {
    handleKey: (event) => {
      if (!ghost || event.type !== "keydown") return false;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return false;
      }
      if (event.key !== "ArrowRight" && event.key !== "End") return false;
      const at = cursorPos();
      if (at.line !== ghost.at.line || at.x !== ghost.at.x) {
        clearGhost();
        return false;
      }
      const text = ghost.full;
      clearGhost();
      deps.writeToPty(text);
      return true;
    },
  });

  return () => {
    disposed = true;
    if (raf !== null) cancelAnimationFrame(raf);
    controllers.delete(term);
    osc.dispose();
    dataSub.dispose();
    writeSub.dispose();
    cursorSub.dispose();
    resizeSub.dispose();
    resetInput();
  };
}
