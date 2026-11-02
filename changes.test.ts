import { describe, expect, it } from "bun:test";
import { applyOwnEdit, buildHunks } from "./changes.js";

const kinds = (hunk: { rows: { kind: string }[] }) => hunk.rows.map((row) => row.kind);

describe("building a diff", () => {
  it("finds nothing when the text is the same", () => {
    expect(buildHunks("a\nb", "a\nb")).toEqual({ hunks: [], added: 0, removed: 0 });
  });

  it("counts added and removed lines", () => {
    const { added, removed } = buildHunks("a\nb\nc", "a\nc\nd\ne");

    expect(added).toBe(2);
    expect(removed).toBe(1);
  });

  it("shows changed lines with two lines of context on each side", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7"].join("\n");
    const after = ["1", "2", "3", "new", "4", "5", "6", "7"].join("\n");

    const { hunks } = buildHunks(before, after);

    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.rows.map((row) => row.text)).toEqual(["2", "3", "new", "4", "5"]);
    expect(kinds(hunks[0]!)).toEqual(["same", "same", "added", "same", "same"]);
  });

  it("points each block at the line to jump to in the current text", () => {
    const before = ["1", "2", "3", "4", "5", "6"].join("\n");
    const after = ["1", "2", "3", "4", "5", "6", "7"].join("\n");

    expect(buildHunks(before, after).hunks[0]!.line).toBe(7);
  });

  it("splits far apart changes into separate blocks", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const after = [...lines];
    after[2] = "changed early";
    after[25] = "changed late";

    expect(buildHunks(lines.join("\n"), after.join("\n")).hunks).toHaveLength(2);
  });

  it("merges changes whose context would overlap", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i}`);
    const after = [...lines];
    after[3] = "one";
    after[6] = "two";

    expect(buildHunks(lines.join("\n"), after.join("\n")).hunks).toHaveLength(1);
  });

  it("shows a removed line before its replacement", () => {
    const { hunks } = buildHunks("old words here", "new words here");

    expect(kinds(hunks[0]!)).toEqual(["removed", "added"]);
  });

  it("treats a new empty last line as a change", () => {
    expect(buildHunks("a", "a\n").added).toBe(1);
  });
});

describe("marking the words that changed", () => {
  const rowsFor = (before: string, after: string) => buildHunks(before, after).hunks[0]!.rows;

  it("marks only the changed words in a Vietnamese line", () => {
    const [removed, added] = rowsFor("Anh ấy đi về nhà muộn.", "Anh ấy trở về nhà rất muộn.");

    expect(removed!.parts).toEqual([
      { text: "Anh ấy ", changed: false },
      { text: "đi", changed: true },
      { text: " về nhà muộn.", changed: false },
    ]);
    expect(added!.parts).toEqual([
      { text: "Anh ấy ", changed: false },
      { text: "trở", changed: true },
      { text: " về nhà ", changed: false },
      { text: "rất ", changed: true },
      { text: "muộn.", changed: false },
    ]);
  });

  it("marks nothing inside a line replaced by something unrelated", () => {
    const [removed, added] = rowsFor("the cat sat on the mat", "completely different text here now");

    expect(removed!.parts).toBeUndefined();
    expect(added!.parts).toBeUndefined();
  });

  it("marks nothing inside a line that was only added", () => {
    const rows = rowsFor("a", "a\nnew line");

    expect(rows.at(-1)!.parts).toBeUndefined();
  });
});

describe("keeping your own typing out of the diff", () => {
  const edit = (start: number, removed: string, inserted: string) => ({ start, removed, inserted });

  it("repeats your edit in the reviewed copy", () => {
    const reviewed = "first paragraph\n\nsecond paragraph";
    const current = "AI INTRO\nfirst paragraph\n\nsecond paragraph";
    const at = current.indexOf("second");

    expect(applyOwnEdit(reviewed, current, edit(at, "", "my "))).toBe("first paragraph\n\nmy second paragraph");
  });

  it("repeats a deletion you made", () => {
    const reviewed = "keep this\ndelete this\nkeep that";
    const current = "AI line\nkeep this\ndelete this\nkeep that";

    expect(applyOwnEdit(reviewed, current, edit(current.indexOf("delete"), "delete this\n", ""))).toBe("keep this\nkeep that");
  });

  it("leaves the copy alone when you edit text the AI just wrote", () => {
    const reviewed = "old text";
    const current = "brand new sentence from the AI";

    expect(applyOwnEdit(reviewed, current, edit(6, "new", "NEW"))).toBe(reviewed);
  });

  it("picks the nearest copy when the same text repeats", () => {
    const reviewed = "same line\nmiddle\nsame line";
    const current = "same line\nmiddle\nsame line";

    expect(applyOwnEdit(reviewed, current, edit(current.lastIndexOf("line"), "line", "row"))).toBe("same line\nmiddle\nsame row");
  });
});
