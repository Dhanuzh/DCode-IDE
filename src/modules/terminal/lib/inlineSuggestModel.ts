/** Absolute buffer position: `line` counts from the top of the scrollback. */
export type CellPos = { line: number; x: number };

export type LineLike = {
  isWrapped: boolean;
  translateToString(trimRight?: boolean, start?: number, end?: number): string;
};

export type BufferLike = {
  getLine(y: number): LineLike | undefined;
};

// A prompt input longer than this is not something history can complete.
const MAX_INPUT_LINES = 8;
export const MAX_SUGGESTION_LENGTH = 1000;

/**
 * What the user has typed at the prompt: the text from where input started to
 * the cursor, plus how many blank cells follow the cursor on its row (a shell
 * drawing its own suggestion, or a right prompt, fills them). Null when the
 * cursor is not somewhere input could be.
 */
export function readPromptInput(
  buffer: BufferLike,
  start: CellPos,
  cursor: CellPos,
  cols: number,
): { typed: string; blankAfter: number } | null {
  if (cursor.line < start.line) return null;
  if (cursor.line === start.line && cursor.x < start.x) return null;
  if (cursor.line - start.line >= MAX_INPUT_LINES) return null;
  let typed = "";
  for (let y = start.line; y <= cursor.line; y++) {
    const line = buffer.getLine(y);
    if (!line) return null;
    // A hard line break inside the input means a continuation prompt
    // (unclosed quote, heredoc): history cannot complete that.
    if (y > start.line && !line.isWrapped) return null;
    const from = y === start.line ? start.x : 0;
    const to = y === cursor.line ? cursor.x : cols;
    typed += line.translateToString(false, from, to);
  }
  const row = buffer.getLine(cursor.line);
  if (!row) return null;
  const rest = row.translateToString(false, cursor.x, cols);
  const firstInk = rest.search(/\S/);
  const blankAfter = firstInk === -1 ? cols - cursor.x : firstInk;
  const next = buffer.getLine(cursor.line + 1);
  const continuesBelow =
    firstInk === -1 &&
    next?.isWrapped === true &&
    /\S/.test(next.translateToString(true));
  return { typed, blankAfter: continuesBelow ? 0 : blankAfter };
}

/** The whole input line starting at `start`, following soft wraps. */
export function readFullInput(
  buffer: BufferLike,
  start: CellPos,
): string | null {
  let out = "";
  for (let y = start.line; y < start.line + MAX_INPUT_LINES; y++) {
    const line = buffer.getLine(y);
    if (!line) break;
    if (y > start.line && !line.isWrapped) break;
    out += line.translateToString(false, y === start.line ? start.x : 0);
  }
  const trimmed = out.replace(/\s+$/, "");
  return trimmed ? trimmed : null;
}

/** The completion to show after `typed`, or null. */
export function ghostFor(
  typed: string,
  suggestion: string | null,
): string | null {
  if (!suggestion || !typed.trim()) return null;
  if (suggestion.length > MAX_SUGGESTION_LENGTH) return null;
  if (!suggestion.startsWith(typed) || suggestion.length <= typed.length) {
    return null;
  }
  // History files can hold raw control bytes; never offer them for insertion.
  if (/[\x00-\x1f\x7f]/.test(suggestion)) return null;
  return suggestion.slice(typed.length);
}

/**
 * The part of the ghost that fits in the blank cells after the cursor. A gap
 * cell is kept before any ink to the right (a right prompt); at the end of the
 * row the ghost may run to the edge.
 */
export function fitGhost(
  ghost: string,
  blankAfter: number,
  cursorX: number,
  cols: number,
): string | null {
  const toEdge = cols - cursorX;
  const room = blankAfter >= toEdge ? toEdge : blankAfter - 1;
  if (room < 1) return null;
  return ghost.length <= room ? ghost : ghost.slice(0, room);
}

/** Whether a command line should enter the in-memory suggestion history. */
export function isRecordableCommand(command: string): boolean {
  if (!command.trim()) return false;
  // Leading space is the shells' "keep this out of history" convention.
  if (/^\s/.test(command)) return false;
  if (command.length > MAX_SUGGESTION_LENGTH) return false;
  return !/[\x00-\x1f\x7f]/.test(command);
}
