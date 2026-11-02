import { describe, expect, it } from "bun:test";
import { followEdit, relocate } from "./marks.js";

const mark = (line: number, text: string) => ({ line, text });

describe("keeping a mark on its line while the note is edited", () => {
  const lines = ["a", "b", "new", "c", "d"];

  it("moves a mark down when lines are added above it", () => {
    expect(followEdit([mark(2, "c")], 2, 0, 1, lines)).toEqual([mark(3, "c")]);
  });

  it("moves a mark up when lines are removed above it", () => {
    expect(followEdit([mark(4, "c")], 1, 2, 0, ["a", "b", "c"])).toEqual([mark(2, "c")]);
  });

  it("leaves a mark above the edit alone", () => {
    const marks = [mark(0, "a")];

    expect(followEdit(marks, 2, 0, 1, lines)).toBe(marks);
  });

  it("updates the preview when the marked line itself is edited", () => {
    expect(followEdit([mark(1, "b")], 1, 1, 1, ["a", "b typed"])).toEqual([mark(1, "b typed")]);
  });

  it("stays on the first line when Enter splits the marked line", () => {
    expect(followEdit([mark(1, "ab")], 1, 1, 2, ["x", "a", "b"])).toEqual([mark(1, "a")]);
  });

  it("merges marks whose lines were deleted together", () => {
    expect(followEdit([mark(1, "b"), mark(2, "c")], 1, 2, 0, ["a", "d"])).toEqual([mark(1, "d")]);
  });

  it("never points past the end of the note", () => {
    expect(followEdit([mark(2, "c")], 1, 2, 0, ["a"])).toEqual([mark(0, "a")]);
  });
});

describe("finding marks again when a note is opened", () => {
  it("keeps a mark whose line is unchanged", () => {
    expect(relocate([mark(1, "b")], ["a", "b"])).toEqual([mark(1, "b")]);
  });

  it("follows the text to the nearest line when the file changed on the PC", () => {
    expect(relocate([mark(1, "b")], ["x", "y", "b", "z", "z", "b"])).toEqual([mark(2, "b")]);
  });

  it("keeps the line number when the text is gone", () => {
    expect(relocate([mark(1, "gone")], ["a", "b"])).toEqual([mark(1, "b")]);
  });

  it("does not search for a blank line, which would match anywhere", () => {
    expect(relocate([mark(2, "")], ["a", "", "b"])).toEqual([mark(2, "b")]);
  });

  it("stays inside a note that got shorter", () => {
    expect(relocate([mark(9, "gone")], ["a", "b"])).toEqual([mark(1, "b")]);
  });

  it("sorts marks and merges any that land on the same line", () => {
    expect(relocate([mark(3, "b"), mark(1, "a"), mark(0, "b")], ["a", "b"])).toEqual([mark(0, "a"), mark(1, "b")]);
  });
});
