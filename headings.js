const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const BULLET = /^\s*[-*+][ \t]+\S/;
const DIVIDER = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
// Lines an underline cannot turn into a heading: blank, indented code, lists, quotes, tables.
const NOT_PROSE = /^\s*$|^(?: {4}|\t)|^ {0,3}(?:[-*+>|]|\d+[.)])(?:\s|$)/;

const plainTitle = (raw) =>
  raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|\*|`/g, "")
    .trim();

function bodyStart(lines) {
  if (lines[0].trimEnd() !== "---") return 0;
  const end = lines.findIndex((line, i) => i > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
  return end === -1 ? 0 : end + 1;
}

// Offsets index the text as given, so the editor can jump straight to a heading.
export function parseHeadings(text) {
  const headings = [];
  const lines = text.split("\n");
  // A byte order mark is kept as text, and it would hide the first line's heading or front matter.
  const bom = lines[0].startsWith("\uFEFF");
  if (bom) lines[0] = lines[0].slice(1);
  const first = bodyStart(lines);
  let offset = bom ? 1 : 0;
  for (let i = 0; i < first; i++) offset += lines[i].length + 1;

  let fence = null;
  let paragraph = null;
  for (let i = first; i < lines.length; i++) {
    const line = lines[i];
    const start = offset;
    offset += line.length + 1;

    if (fence) {
      const closing = line.trim();
      const closes =
        /^ {0,3}\S/.test(line) && closing.length >= fence.length && closing === fence[0].repeat(closing.length);
      if (closes) fence = null;
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      fence = open[1];
      paragraph = null;
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      const title = plainTitle((atx[2] ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/, ""));
      if (title) headings.push({ level: atx[1].length, title, offset: start, line: i, bullets: 0 });
      paragraph = null;
      continue;
    }

    const underline = UNDERLINE.exec(line);
    if (underline) {
      const title = paragraph && plainTitle(paragraph.line);
      if (title) {
        headings.push({ level: underline[1][0] === "=" ? 1 : 2, title, offset: paragraph.start, line: paragraph.index, bullets: 0 });
      }
      paragraph = null;
      continue;
    }

    if (BULLET.test(line) && !DIVIDER.test(line) && headings.length) headings[headings.length - 1].bullets++;
    paragraph = NOT_PROSE.test(line) ? null : { line, start, index: i };
  }
  return headings;
}
