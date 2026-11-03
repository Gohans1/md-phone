import { describe, expect, it } from "bun:test";
import { countPerHeading, createMark, followEdit, relocate } from "./marks.js";

const offsets = (marks: { offset: number }[]) => marks.map((mark) => mark.offset);

describe("placing a mark", () => {
  it("remembers the exact character, with the text on both sides", () => {
    expect(createMark("hello world", 5)).toMatchObject({ offset: 5, before: "hello", after: " world" });
  });

  it("keeps only a short piece of text around it", () => {
    const mark = createMark("a".repeat(100) + "b".repeat(100), 100);

    expect(mark.before).toBe("a".repeat(32));
    expect(mark.after).toBe("b".repeat(32));
  });
});

describe("keeping a mark on its character while the note is edited", () => {
  const follow = (offset: number, before: string, start: number, removed: string, inserted: string) => {
    const after = before.slice(0, start) + inserted + before.slice(start + removed.length);
    return followEdit([createMark(before, offset)], { start, removed, inserted }, after);
  };

  it("moves right when text is typed before it", () => {
    const [mark] = follow(6, "hello world", 0, "", "oh ");

    expect(mark).toMatchObject({ offset: 9, before: "oh hello ", after: "world" });
  });

  it("moves left when text before it is deleted", () => {
    expect(offsets(follow(6, "hello world", 0, "hello ", ""))).toEqual([0]);
  });

  it("stays put when text is typed after it", () => {
    expect(offsets(follow(2, "hello", 4, "", "x"))).toEqual([2]);
  });

  it("stays in front of text typed exactly at the mark", () => {
    expect(offsets(follow(5, "hello world", 5, "", "!"))).toEqual([5]);
  });

  it("moves to where a deleted block was when the mark was inside it", () => {
    expect(offsets(follow(6, "hello world", 2, "llo wo", ""))).toEqual([2]);
  });

  it("returns the same list when the edit does not touch any mark", () => {
    const text = `${"a".repeat(40)}${"b".repeat(40)}`;
    const marks = [createMark(text, 5)];

    expect(followEdit(marks, { start: 70, removed: "", inserted: "x" }, `${text.slice(0, 70)}x${text.slice(70)}`)).toBe(marks);
  });

  it("merges marks that end up on the same character", () => {
    const text = "abcdef";
    const marks = [createMark(text, 2), createMark(text, 4)];

    expect(offsets(followEdit(marks, { start: 1, removed: "bcde", inserted: "" }, "af"))).toEqual([1]);
  });
});

describe("finding marks again when a note is opened", () => {
  it("keeps a mark whose surroundings are unchanged", () => {
    const text = "hello world";

    expect(offsets(relocate([createMark(text, 6)], text))).toEqual([6]);
  });

  it("follows the surrounding text when the file changed on the PC", () => {
    const mark = createMark("hello world", 6);

    expect(offsets(relocate([mark], "new first line\nhello world"))).toEqual([21]);
  });

  it("picks the nearest copy when the text repeats", () => {
    const mark = { offset: 12, before: "ab", after: "cd" };

    expect(offsets(relocate([mark], "abcd--------abcd----------------abcd"))).toEqual([14]);
  });

  it("keeps the position when the text is gone", () => {
    expect(offsets(relocate([{ offset: 3, before: "gone", after: "text" }], "completely different"))).toEqual([3]);
  });

  it("stays inside a note that got shorter", () => {
    expect(offsets(relocate([{ offset: 99, before: "gone", after: "" }], "short"))).toEqual([5]);
  });

  it("sorts marks and refreshes their surroundings", () => {
    const text = "one two three";

    expect(offsets(relocate([createMark(text, 8), createMark(text, 4)], text))).toEqual([4, 8]);
  });
});

describe("counting marks per heading", () => {
  const headings = [{ offset: 10 }, { offset: 20 }, { offset: 30 }];

  it("counts a mark under the last heading before it", () => {
    expect(countPerHeading(headings, [{ offset: 10 }, { offset: 15 }, { offset: 25 }])).toEqual([2, 1, 0]);
  });

  it("counts everything after the last heading under it", () => {
    expect(countPerHeading(headings, [{ offset: 999 }])).toEqual([0, 0, 1]);
  });

  it("leaves out marks above the first heading", () => {
    expect(countPerHeading(headings, [{ offset: 3 }])).toEqual([0, 0, 0]);
  });
});

describe("a mark's identity", () => {
  it("survives edits and relocating, so devices can tell which mark is which", () => {
    const mark = createMark("hello world", 6);

    const followed = followEdit([mark], { start: 0, removed: "", inserted: "oh " }, "oh hello world")[0]!;
    const relocated = relocate([followed], "x oh hello world")[0]!;

    expect(relocated.id).toBe(mark.id);
    expect(relocated.offset).toBe(11);
  });

  it("differs between marks", () => {
    expect(createMark("hello", 1).id).not.toBe(createMark("hello", 1).id);
  });
});

describe("a mark in a note edited while it was closed", () => {
  it("finds its place by the text on one side when the other side changed", () => {
    const text = `${"short line\n".repeat(5)}The quick brown fox jumps over the lazy dog today\nend`;
    const mark = createMark(text, text.indexOf("jumps"));
    const edited = `${"added line\n".repeat(20)}${text.replace("jumps", "leaps")}`;

    expect(relocate([mark], edited)[0]!.offset).toBe(edited.indexOf("leaps"));
  });
});

describe("marks through an outside edit in two places", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `This is line number ${i} of the script`);
  const before = lines.join("\n");
  const offsetOf = (text: string, line: number) => text.indexOf(`line number ${line} `);

  it("keeps marks between the two edits on their own lines", () => {
    const after = ["FIRST EDIT", ...lines.slice(1, 39), "LAST EDIT"].join("\n");
    const marks = [10, 20, 30].map((line) => createMark(before, offsetOf(before, line)));
    const start = 0;
    const removed = before;
    const inserted = after;

    const followed = followEdit(marks, { start, removed, inserted }, after);

    expect(followed.map(({ offset }: { offset: number }) => offset)).toEqual([10, 20, 30].map((line) => offsetOf(after, line)));
  });

  it("still gathers marks at the edit when their text was really replaced", () => {
    const text = "aaaaaaaaaa something unique here bbbbbbbbbb";
    const mark = createMark(text, 20);
    const after = "aaaaaaaaaa X bbbbbbbbbb";

    expect(followEdit([mark], { start: 11, removed: "something unique here", inserted: "X" }, after)[0]!.offset).toBe(11);
  });
});
