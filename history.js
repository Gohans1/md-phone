const MERGE_WINDOW_MS = 1000;
const MAX_MERGED_EDIT = 32;
const MAX_STEPS = 100;
const MAX_CHARS = 200_000;

export const createHistory = (text) => ({ text, done: [], undone: [], at: 0 });

function diff(before, after) {
  const shortest = Math.min(before.length, after.length);
  let start = 0;
  while (start < shortest && before[start] === after[start]) start++;
  let tail = 0;
  while (tail < shortest - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return { start, removed: before.slice(start, before.length - tail), inserted: after.slice(start, after.length - tail) };
}

const isBlockEdit = ({ removed, inserted }) =>
  removed.includes("\n") || inserted.includes("\n") || removed.length > MAX_MERGED_EDIT || inserted.length > MAX_MERGED_EDIT;

function merge(last, edit) {
  if (last.block || isBlockEdit(edit)) return null;
  const offset = edit.start - last.start;
  if (offset >= 0 && offset + edit.removed.length <= last.inserted.length) {
    const inserted = last.inserted.slice(0, offset) + edit.inserted + last.inserted.slice(offset + edit.removed.length);
    return { start: last.start, removed: last.removed, inserted };
  }
  if (!edit.inserted && !last.inserted && edit.start + edit.removed.length === last.start) {
    return { start: edit.start, removed: edit.removed + last.removed, inserted: "" };
  }
  return null;
}

function trim(history) {
  while (history.done.length > MAX_STEPS) history.done.shift();
  let chars = history.done.reduce((sum, { removed, inserted }) => sum + removed.length + inserted.length, 0);
  while (history.done.length > 1 && chars > MAX_CHARS) {
    const oldest = history.done.shift();
    chars -= oldest.removed.length + oldest.inserted.length;
  }
}

// A burst of typing is one step; a block edit or a change from the PC is always its own step.
export function record(history, next, now, { separate = false } = {}) {
  if (next === history.text) return;
  const edit = diff(history.text, next);
  const last = history.done.at(-1);
  const merged = !separate && last && now - history.at < MERGE_WINDOW_MS ? merge(last, edit) : null;
  if (merged) history.done[history.done.length - 1] = merged;
  else history.done.push({ ...edit, block: separate || isBlockEdit(edit) });
  history.text = next;
  history.undone = [];
  history.at = now;
  trim(history);
}

function step(history, from, to, oldText, newText) {
  const edit = history[from].pop();
  if (!edit) return null;
  history[to].push(edit);
  const end = edit.start + edit[oldText].length;
  history.text = history.text.slice(0, edit.start) + edit[newText] + history.text.slice(end);
  history.at = 0;
  return { start: edit.start, end, text: edit[newText], caret: edit.start + edit[newText].length };
}

export const undo = (history) => step(history, "done", "undone", "inserted", "removed");
export const redo = (history) => step(history, "undone", "done", "removed", "inserted");

export function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${hash >>> 0}`;
}
