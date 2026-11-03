import { nearestCopy } from "./marks.js";
import { diffArrays, diffWordsWithSpace } from "./vendor/diff.js";

const CONTEXT_LINES = 2;
const OWN_EDIT_CONTEXTS = [32, 16, 8];
const MIN_SHARED_TO_MARK_WORDS = 0.4;
const DIFF_TIMEOUT_MS = 1000;
// Comparing the words of long rewritten lines can take seconds, and the diff in the note runs on every update.
const WORD_DIFF_BUDGET_MS = 200;

// Lines with little in common read better as one line replacing the other than as a scatter of changed words,
// and so do lines that would take past the deadline to compare.
function similarWords(oldLine, newLine, deadline) {
  const timeout = deadline - Date.now();
  const words = timeout > 0 ? diffWordsWithSpace(oldLine, newLine, { timeout }) : undefined;
  if (!words) return null;
  const shared = words.reduce((sum, word) => (word.added || word.removed ? sum : sum + word.value.trim().length), 0);
  return shared < Math.max(oldLine.length, newLine.length) * MIN_SHARED_TO_MARK_WORDS ? null : words;
}

function wordParts(oldLine, newLine, deadline) {
  const words = similarWords(oldLine, newLine, deadline);
  if (!words) return null;
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

// A note rewritten beyond recognition can take too long to compare, so it shows as replaced whole.
const lineBlocks = (oldLines, newLines) =>
  diffArrays(oldLines, newLines, { timeout: DIFF_TIMEOUT_MS }) ?? [
    { removed: true, value: oldLines },
    { added: true, value: newLines },
  ];

function buildRows(before, after) {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const blocks = lineBlocks(oldLines, newLines);
  const deadline = Date.now() + WORD_DIFF_BUDGET_MS;
  const rows = [];
  let line = 1;
  blocks.forEach((block, index) => {
    if (block.removed) {
      const replacement = blocks[index + 1]?.added ? blocks[index + 1].value : [];
      block.value.forEach((text, i) => {
        const parts = i < replacement.length ? wordParts(text, replacement[i], deadline) : null;
        rows.push({ kind: "removed", text, line, ...(parts && { parts: parts.removed }) });
      });
      return;
    }
    const replaced = block.added && blocks[index - 1]?.removed ? blocks[index - 1].value : [];
    for (const [i, text] of block.value.entries()) {
      if (block.added) {
        const parts = i < replaced.length ? wordParts(replaced[i], text, deadline) : null;
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

// A change counts as read after two seconds on screen plus reading time at about 240 words a minute,
// the average silent reading rate (Brysbaert 2019). No cap: a long change takes as long as it takes to read.
const SEEN_BASE_MS = 2000;
const SEEN_PER_WORD_MS = 250;

export const readingTime = (words) => SEEN_BASE_MS + words * SEEN_PER_WORD_MS;

function addSpan(spans, from, to) {
  const merged = [];
  for (const [a, b] of [...spans, [from, to]].sort((x, y) => x[0] - y[0])) {
    if (merged.length && a <= merged.at(-1)[1]) merged.at(-1)[1] = Math.max(merged.at(-1)[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

// One look at a change on screen, given what earlier looks found: when it came into view, and which parts of it were seen.
// In view means half of it, or half the screen's worth, without a break, like an ad counts as viewed.
// A change taller than the screen also needs every part of it to have been on screen.
export function lookAt(track, { top, bottom, viewTop, viewBottom, now, looking }, readMs) {
  const height = Math.max(bottom - top, 1);
  const from = Math.max(top, viewTop);
  const to = Math.min(bottom, viewBottom);
  const shown = to - from;
  if (!looking || shown <= 0 || (shown < height / 2 && shown < (viewBottom - viewTop) / 2)) return { since: null, covered: track.covered, seen: false };
  const covered = addSpan(track.covered, from - top, to - top);
  const since = track.since ?? now;
  const whole = covered.length === 1 && covered[0][0] <= 1 && covered[0][1] >= height - 1;
  return { since, covered, seen: whole && now - since >= readMs };
}

const countWords = (text) => text.match(/\S+/g)?.length ?? 0;

// Runs of changed lines, as line ranges in both texts, or null when comparing them took too long.
function changedRuns(oldLines, newLines) {
  const blocks = diffArrays(oldLines, newLines, { timeout: DIFF_TIMEOUT_MS });
  if (!blocks) return null;
  const runs = [];
  let oldAt = 0;
  let newAt = 0;
  for (const block of blocks) {
    const open = runs.at(-1);
    const continues = open && open.oldTo === oldAt && open.newTo === newAt;
    if (!block.added && !block.removed) {
      oldAt += block.value.length;
      newAt += block.value.length;
      continue;
    }
    const run = continues ? open : { oldFrom: oldAt, oldTo: oldAt, newFrom: newAt, newTo: newAt };
    if (block.removed) oldAt = run.oldTo = oldAt + block.value.length;
    else newAt = run.newTo = newAt + block.value.length;
    if (!continues) runs.push(run);
  }
  return runs;
}

// Each run of changed lines, placed in the current text: new text to light up, and old text to show struck out where it was.
export function inlineChanges(before, after) {
  if (before === after) return [];
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const starts = [];
  newLines.reduce((at, line) => (starts.push(at), at + line.length + 1), 0);
  // A note rewritten beyond recognition shows as replaced whole.
  const runs = changedRuns(oldLines, newLines) ?? [{ oldFrom: 0, oldTo: oldLines.length, newFrom: 0, newTo: newLines.length }];
  // Started after the line comparison, which on a long note can take the whole budget by itself.
  const deadline = Date.now() + WORD_DIFF_BUDGET_MS;
  return runs.map((change) => {
    const removedLines = oldLines.slice(change.oldFrom, change.oldTo);
    const addedLines = newLines.slice(change.newFrom, change.newTo);
    const words = countWords(removedLines.join(" ")) + countWords(addedLines.join(" "));
    const pairs = removedLines.length === addedLines.length ? removedLines.map((line, i) => similarWords(line, addedLines[i], deadline)) : [];
    if (pairs.length && pairs.every(Boolean)) {
      const added = [];
      const removed = [];
      pairs.forEach((parts, i) => {
        let at = starts[change.newFrom + i];
        for (const part of parts) {
          if (part.removed) removed.push({ at, text: part.value });
          else if (part.added) added.push({ start: at, end: at + part.value.length });
          if (!part.removed) at += part.value.length;
        }
      });
      const changedWords = countWords(removed.map(({ text }) => text).join(" ")) + added.reduce((sum, { start, end }) => sum + countWords(after.slice(start, end)), 0);
      return { ...change, added, removed, words: changedWords };
    }
    const added = addedLines.length ? [{ start: starts[change.newFrom], end: starts[change.newTo - 1] + addedLines.at(-1).length }] : [];
    const atEnd = change.newTo === newLines.length && !addedLines.length;
    const removed = !removedLines.length ? [] : atEnd
      ? [{ at: after.length, text: `\n${removedLines.join("\n")}`, end: true }]
      : [{ at: starts[change.newFrom], text: `${removedLines.join("\n")}\n` }];
    // Blank lines have nothing to light up or to read.
    return { ...change, added: added.filter(({ start, end }) => after.slice(start, end).trim()), removed, words };
  });
}

// Undoing or redoing someone else's write is the reader's own doing, so the review takes it, while changes it didn't touch stay unseen.
// A neighbouring line the review doesn't share can't be told apart from the undo, so it goes with it.
export function undoIntoReview(reviewed, before, after) {
  const reviewedLines = reviewed.split("\n");
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const shared = changedRuns(reviewedLines, beforeLines);
  const undone = changedRuns(beforeLines, afterLines);
  // A comparison that took too long tells nothing, and treating it as everything would accept every unread change.
  if (!shared || !undone) return reviewed;
  const inReview = new Map();
  let reviewAt = 0;
  let beforeAt = 0;
  for (const run of shared) {
    while (beforeAt < run.newFrom) inReview.set(beforeAt++, reviewAt++);
    reviewAt = run.oldTo;
    beforeAt = run.newTo;
  }
  while (beforeAt < beforeLines.length) inReview.set(beforeAt++, reviewAt++);
  const spans = [];
  for (const run of undone) {
    let { oldFrom: from, oldTo: to, newFrom: afterFrom, newTo: afterTo } = run;
    while (from > 0 && !inReview.has(from - 1)) (from--, afterFrom--);
    while (to < beforeLines.length && !inReview.has(to)) (to++, afterTo++);
    const last = spans.at(-1);
    if (last && from <= last.to) Object.assign(last, { to, afterTo });
    else spans.push({ from, to, afterFrom, afterTo });
  }
  const lines = [...reviewedLines];
  for (const { from, to, afterFrom, afterTo } of spans.reverse()) {
    const start = from === 0 ? 0 : inReview.get(from - 1) + 1;
    const end = to === beforeLines.length ? reviewedLines.length : inReview.get(to);
    lines.splice(start, end - start, ...afterLines.slice(afterFrom, afterTo));
  }
  return lines.join("\n");
}

// Changes of a rebuilt diff that the review copy already took, found by where they sit in the current text.
export function alreadyRead(changes, reviewed, after) {
  const open = changedRuns(reviewed.split("\n"), after.split("\n"));
  if (!open) return new Set();
  const touches = (a, b) => a.newFrom <= b.newTo && b.newFrom <= a.newTo;
  return new Set(changes.flatMap((change, index) => (open.some((run) => touches(run, change)) ? [] : [index])));
}

// The diff to show after a rebuild. Against `lingering` (the text with read changes still on screen left out), those changes
// stay dimmed in place, but only while it adds up to the review exactly: if the AI rewrote one of them, it starts from the review.
// Either way `reviewWithSeen(before, after, changes, read)` is the review, so reading more needs no further comparing.
export function rebuiltChanges(reviewed, after, lingering) {
  if (lingering !== null) {
    const changes = inlineChanges(lingering, after);
    const read = alreadyRead(changes, reviewed, after);
    if (reviewWithSeen(lingering, after, changes, read) === reviewed) return { before: lingering, changes, read };
  }
  return { before: reviewed, changes: inlineChanges(reviewed, after), read: new Set() };
}

// The reviewed copy takes only the changes that were seen, so the rest still show next time.
export function reviewWithSeen(before, after, changes, seen) {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const lines = [];
  let oldAt = 0;
  changes.forEach((change, index) => {
    lines.push(...oldLines.slice(oldAt, change.oldFrom));
    lines.push(...(seen.has(index) ? newLines.slice(change.newFrom, change.newTo) : oldLines.slice(change.oldFrom, change.oldTo)));
    oldAt = change.oldTo;
  });
  lines.push(...oldLines.slice(oldAt));
  return lines.join("\n");
}

// Your own typing goes into the reviewed copy too, so the diff only ever shows what someone else changed.
// Where an offset of the current text sits in the reviewed copy, shifted past the lines only one of them has.
function offsetInReview(reviewed, current, offset) {
  const reviewedLines = reviewed.split("\n");
  const currentLines = current.split("\n");
  const runs = changedRuns(reviewedLines, currentLines);
  if (!runs) return offset;
  let line = 0;
  let lineAt = 0;
  while (line < currentLines.length - 1 && offset > lineAt + currentLines[line].length) {
    lineAt += currentLines[line].length + 1;
    line++;
  }
  let shift = 0;
  for (const run of runs) {
    if (run.newFrom > line) break;
    if (run.newTo > line) return offset;
    shift += run.oldTo - run.oldFrom - (run.newTo - run.newFrom);
  }
  const reviewedLine = line + shift;
  return reviewedLines.slice(0, reviewedLine).reduce((sum, text) => sum + text.length + 1, 0) + offset - lineAt;
}

export function applyOwnEdit(reviewed, current, { start, removed, inserted }) {
  const end = start + removed.length;
  // Text the AI added may sit right next to the edit, so less and less of the surroundings has to match.
  for (const size of OWN_EDIT_CONTEXTS) {
    const before = current.slice(Math.max(0, start - size), start);
    const after = current.slice(end, end + size);
    const needle = before + removed + after;
    if (!needle.trim()) return reviewed;
    // Identical rows (checklists, empty table rows) need the right one, and unread lines above shift where it is.
    const near = Math.max(0, start - before.length);
    const repeats = reviewed.indexOf(needle) !== reviewed.lastIndexOf(needle);
    const found = nearestCopy(reviewed, needle, repeats ? offsetInReview(reviewed, current, near) : near);
    if (found === -1) continue;
    const at = found + before.length;
    return reviewed.slice(0, at) + inserted + reviewed.slice(at + removed.length);
  }
  return reviewed;
}
