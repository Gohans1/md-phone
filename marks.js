const uniqueSorted = (marks) => {
  const byLine = new Map(marks.map((mark) => [mark.line, mark]));
  return [...byLine.values()].sort((a, b) => a.line - b.line);
};

function nearestSameText(lines, from, text) {
  for (let distance = 0; distance < lines.length; distance++) {
    if (lines[from - distance] === text) return from - distance;
    if (lines[from + distance] === text) return from + distance;
  }
  return -1;
}

// Marks follow their line through an edit that replaced `removed` lines at `head` with `added` new ones.
export function followEdit(marks, head, removed, added, lines) {
  let changed = false;
  const moved = marks.map((mark) => {
    let line = mark.line;
    if (line >= head + removed) line += added - removed;
    else if (line >= head) line = Math.min(line, head + Math.max(added - 1, 0));
    line = Math.min(line, lines.length - 1);
    const text = lines[line];
    if (line !== mark.line || text !== mark.text) changed = true;
    return { line, text };
  });
  return changed ? uniqueSorted(moved) : marks;
}

// The file may have changed on the PC since the marks were saved, so line numbers alone can't be trusted.
export function relocate(marks, lines) {
  return uniqueSorted(
    marks.map((mark) => {
      const last = lines.length - 1;
      const from = Math.min(mark.line, last);
      const found = mark.text.trim() ? nearestSameText(lines, from, mark.text) : -1;
      const line = found === -1 ? from : found;
      return { line, text: lines[line] };
    }),
  );
}
