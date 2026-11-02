const CONTEXT = 32;

export const createMark = (text, offset) => ({
  offset,
  before: text.slice(Math.max(0, offset - CONTEXT), offset),
  after: text.slice(offset, offset + CONTEXT),
});

const uniqueSorted = (marks) => {
  const byOffset = new Map(marks.map((mark) => [mark.offset, mark]));
  return [...byOffset.values()].sort((a, b) => a.offset - b.offset);
};

// Marks stay on their character through an edit that replaced `removed` with `inserted` at `start`.
export function followEdit(marks, { start, removed, inserted }, text) {
  let changed = false;
  const moved = marks.map((mark) => {
    let offset = mark.offset;
    if (offset >= start + removed.length && (removed || offset > start)) offset += inserted.length - removed.length;
    else if (offset > start) offset = start;
    const next = createMark(text, offset);
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
      const context = mark.before + mark.after;
      const found = context.trim() ? nearestCopy(text, context, Math.max(0, from - mark.before.length)) : -1;
      return createMark(text, found === -1 ? from : found + mark.before.length);
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
