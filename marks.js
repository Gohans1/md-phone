const CONTEXT = 32;
const MIN_CLUE = 8;

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

// Marks saved before they had ids are known by their context, which every device computes the same way.
export const markId = (mark) => mark.id ?? mark.before + mark.after;

export const createMark = (text, offset, id = newId()) => ({
  id,
  offset,
  before: text.slice(Math.max(0, offset - CONTEXT), offset),
  after: text.slice(offset, offset + CONTEXT),
});

const uniqueSorted = (marks) => {
  const byOffset = new Map(marks.map((mark) => [mark.offset, mark]));
  return [...byOffset.values()].sort((a, b) => a.offset - b.offset);
};

// Full context first, then either side, since an edit next to the mark changes one of them.
function findByContext(mark, text, offset) {
  const clues = [
    [mark.before + mark.after, mark.before.length, 1],
    [mark.after, 0, MIN_CLUE],
    [mark.before, mark.before.length, MIN_CLUE],
  ];
  for (const [needle, lead, shortest] of clues) {
    if (needle.trim().length < shortest) continue;
    const found = nearestCopy(text, needle, offset - lead);
    if (found !== -1) return found + lead;
  }
  return -1;
}

// An outside edit in two places looks like one big replacement, so a mark inside it may still have its text there.
function spotInReplacement(mark, offset, start, inserted, text) {
  if (!inserted) return start;
  const from = Math.max(0, start - CONTEXT);
  const found = findByContext(mark, text.slice(from, start + inserted.length + CONTEXT), offset - from);
  return found === -1 ? start : from + found;
}

// Marks stay on their character through an edit that replaced `removed` with `inserted` at `start`.
export function followEdit(marks, { start, removed, inserted }, text) {
  let changed = false;
  const moved = marks.map((mark) => {
    let offset = mark.offset;
    if (offset >= start + removed.length && (removed || offset > start)) offset += inserted.length - removed.length;
    else if (offset > start) offset = spotInReplacement(mark, offset, start, inserted, text);
    const next = createMark(text, offset, markId(mark));
    if (next.offset !== mark.offset || next.before !== mark.before || next.after !== mark.after) changed = true;
    return next;
  });
  return changed ? uniqueSorted(moved) : marks;
}

export function nearestCopy(text, needle, from) {
  const ahead = text.indexOf(needle, from);
  const behind = text.lastIndexOf(needle, from);
  if (ahead === -1) return behind;
  if (behind === -1) return ahead;
  return ahead - from <= from - behind ? ahead : behind;
}

// The file may have changed on the PC since the marks were saved, so positions alone can't be trusted.
export function relocate(marks, text) {
  return uniqueSorted(
    marks.map((mark) => {
      const from = Math.min(mark.offset, text.length);
      const found = findByContext(mark, text, from);
      return createMark(text, found === -1 ? from : found, markId(mark));
    }),
  );
}

export function countPerHeading(headings, marks) {
  const counts = headings.map(() => 0);
  for (const { offset } of marks) {
    const owner = headings.findLastIndex((heading) => heading.offset <= offset);
    if (owner !== -1) counts[owner]++;
  }
  return counts;
}
