import { nearestCopy } from "./marks.js";
import { diffArrays, diffWordsWithSpace } from "./vendor/diff.js";

const CONTEXT_LINES = 2;
const OWN_EDIT_CONTEXTS = [32, 16, 8];
const MIN_SHARED_TO_MARK_WORDS = 0.4;
const DIFF_TIMEOUT_MS = 1000;

function wordParts(oldLine, newLine) {
  const words = diffWordsWithSpace(oldLine, newLine);
  const shared = words.reduce((sum, word) => (word.added || word.removed ? sum : sum + word.value.trim().length), 0);
  if (shared < Math.max(oldLine.length, newLine.length) * MIN_SHARED_TO_MARK_WORDS) return null;
  const partsOf = (hiddenKey, markedKey) => {
    const parts = [];
    for (const word of words) {
      if (word[hiddenKey]) continue;
      const changed = Boolean(word[markedKey]);
      if (parts.at(-1)?.changed === changed) parts.at(-1).text += word.value;
      else parts.push({ text: word.value, changed });
    }
    return parts;
  };
  return { removed: partsOf("added", "removed"), added: partsOf("removed", "added") };
}

function buildRows(before, after) {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  // A note rewritten beyond recognition can take too long to compare, so it shows as replaced whole.
  const blocks = diffArrays(oldLines, newLines, { timeout: DIFF_TIMEOUT_MS }) ?? [
    { removed: true, value: oldLines },
    { added: true, value: newLines },
  ];
  const rows = [];
  let line = 1;
  blocks.forEach((block, index) => {
    if (block.removed) {
      const replacement = blocks[index + 1]?.added ? blocks[index + 1].value : [];
      block.value.forEach((text, i) => {
        const parts = i < replacement.length ? wordParts(text, replacement[i]) : null;
        rows.push({ kind: "removed", text, line, ...(parts && { parts: parts.removed }) });
      });
      return;
    }
    const replaced = block.added && blocks[index - 1]?.removed ? blocks[index - 1].value : [];
    for (const [i, text] of block.value.entries()) {
      if (block.added) {
        const parts = i < replaced.length ? wordParts(replaced[i], text) : null;
        rows.push({ kind: "added", text, line, ...(parts && { parts: parts.added }) });
      } else {
        rows.push({ kind: "same", text, line });
      }
      line++;
    }
  });
  return rows;
}

export function buildHunks(before, after) {
  if (before === after) return { hunks: [], added: 0, removed: 0 };
  const rows = buildRows(before, after);
  const hunks = [];
  let open = null;
  rows.forEach((row, index) => {
    if (row.kind === "same") return;
    const from = Math.max(0, index - CONTEXT_LINES);
    const to = Math.min(rows.length - 1, index + CONTEXT_LINES);
    if (open && from <= open.to + 1) {
      open.to = to;
    } else {
      open = { from, to, line: row.line };
      hunks.push(open);
    }
  });
  return {
    hunks: hunks.map(({ from, to, line }) => ({ line, rows: rows.slice(from, to + 1) })),
    added: rows.filter((row) => row.kind === "added").length,
    removed: rows.filter((row) => row.kind === "removed").length,
  };
}

// Your own typing goes into the reviewed copy too, so the diff only ever shows what someone else changed.
export function applyOwnEdit(reviewed, current, { start, removed, inserted }) {
  const end = start + removed.length;
  // Text the AI added may sit right next to the edit, so less and less of the surroundings has to match.
  for (const size of OWN_EDIT_CONTEXTS) {
    const before = current.slice(Math.max(0, start - size), start);
    const after = current.slice(end, end + size);
    const needle = before + removed + after;
    if (!needle.trim()) return reviewed;
    const found = nearestCopy(reviewed, needle, Math.max(0, start - before.length));
    if (found === -1) continue;
    const at = found + before.length;
    return reviewed.slice(0, at) + inserted + reviewed.slice(at + removed.length);
  }
  return reviewed;
}
