import { describe, expect, it } from "bun:test";
import { alreadyRead, applyOwnEdit, buildHunks, inlineChanges, lookAt, readingTime, rebuiltChanges, reviewWithSeen, undoIntoReview } from "./changes.js";

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

  it("ticks the right one of many identical rows when the AI added lines above them", () => {
    const rows = Array.from({ length: 40 }, () => "- [ ] call the bank about the card");
    const reviewed = rows.join("\n");
    const current = [...Array.from({ length: 10 }, (_, i) => `AI line ${i}`), ...rows].join("\n");
    const third = current.split("\n").slice(0, 12).join("\n").length + 1;

    const ticked = applyOwnEdit(reviewed, current, edit(third + 3, " ", "x")).split("\n");

    expect(ticked.findIndex((row: string) => row.startsWith("- [x]"))).toBe(2);
  });

  it("picks the nearest copy when the same text repeats", () => {
    const reviewed = "same line\nmiddle\nsame line";
    const current = "same line\nmiddle\nsame line";

    expect(applyOwnEdit(reviewed, current, edit(current.lastIndexOf("line"), "line", "row"))).toBe("same line\nmiddle\nsame row");
  });
});

describe("showing changes inside the note", () => {
  const shown = (before: string, after: string) =>
    (inlineChanges(before, after) as { added: { start: number; end: number }[]; removed: { at: number; text: string; end?: boolean }[] }[]).map(
      ({ added, removed }) => ({ added: added.map(({ start, end }) => after.slice(start, end)), removed }),
    );

  it("shows a replaced word next to its new text", () => {
    const after = "the quick red fox";

    expect(shown("the quick brown fox", after)).toEqual([{ added: ["red"], removed: [{ at: after.indexOf("red"), text: "brown" }] }]);
  });

  it("shows an added line", () => {
    expect(shown("a\nc", "a\nb\nc")).toEqual([{ added: ["b"], removed: [] }]);
  });

  it("shows a removed line where it was, before the line that followed it", () => {
    const after = "a\nc";

    expect(shown("a\nb\nc", after)).toEqual([{ added: [], removed: [{ at: after.indexOf("c"), text: "b\n" }] }]);
  });

  it("shows a removed last line after the end, and says so", () => {
    expect(shown("a\nb", "a")).toEqual([{ added: [], removed: [{ at: 1, text: "\nb", end: true }] }]);
  });

  it("keeps a removed run that starts with a blank line apart from one at the end", () => {
    const after = "a\nc";

    expect(shown("a\n\nb\nc", after)).toEqual([{ added: [], removed: [{ at: 2, text: "\nb\n" }] }]);
  });

  it("shows a run whole when only some of its lines resemble their old versions", () => {
    const after = "the quick red fox\ncompletely different words";

    expect(shown("the quick brown fox\nan old sentence", after)).toEqual([
      { added: [after], removed: [{ at: 0, text: "the quick brown fox\nan old sentence\n" }] },
    ]);
  });

  it("shows a rewritten line whole, the old one first", () => {
    expect(shown("a\nan old sentence\nc", "a\ncompletely different words\nc")).toEqual([
      { added: ["completely different words"], removed: [{ at: 2, text: "an old sentence\n" }] },
    ]);
  });

  it("keeps changes far apart as separate pieces, each with its own reading time", () => {
    const lines = ["one", "two", "three", "four", "five", "six", "seven", "eight"];
    const after = ["ONE", ...lines.slice(1, -1), "EIGHT and more"].join("\n");

    const changes = inlineChanges(lines.join("\n"), after) as { words: number }[];

    expect(changes.map(({ words }) => words)).toEqual([2, 4]);
  });

  it("gives a changed word only that word's reading time, not its whole line's", () => {
    const [change] = inlineChanges("the quick brown fox jumps", "the quick red fox jumps") as { words: number }[];

    expect(change!.words).toBe(2);
  });

  it("shows nothing for blank lines that were added, since there is nothing to light up", () => {
    expect(shown("a\nb", "a\n\nb")).toEqual([{ added: [], removed: [] }]);
    expect(shown("a\nb", "a\n\n\n  \nb")).toEqual([{ added: [], removed: [] }]);
  });

  it("shows a long line whole when comparing its words would take too long", () => {
    const words = Array.from({ length: 12_000 }, (_, i) => `w${i}`);
    const before = words.join(" ");
    const after = words.map((word, i) => (i % 2 ? `x${i}` : word)).join(" ");
    const started = performance.now();

    const [change] = inlineChanges(before, after) as { removed: { at: number; text: string }[] }[];

    expect(performance.now() - started).toBeLessThan(3000);
    expect(change!.removed).toEqual([{ at: 0, text: `${before}\n` }]);
  });

  it("still compares words when a long note takes a while to compare by line", () => {
    const before = Array.from({ length: 3000 }, (_, i) => `Paragraph ${i}: một câu khá dài để note nặng giống ghi chú thật.`);
    const after = before.map((line, i) => (i % 4 ? line : line.replace("khá dài", "rất dài")));

    const changes = inlineChanges(before.join("\n"), after.join("\n")) as { words: number }[];

    expect(changes.every(({ words }) => words === 2)).toBe(true);
  });

  it("finds nothing when the text is the same", () => {
    expect(inlineChanges("a\nb", "a\nb")).toEqual([]);
  });
});

describe("reviewing changes one at a time", () => {
  const before = ["one", "two", "three", "four", "five", "six"].join("\n");
  const after = ["ONE", "two", "three", "four", "five", "SIX"].join("\n");
  const changes = inlineChanges(before, after);

  it("takes the new text only of the changes that were seen", () => {
    expect(reviewWithSeen(before, after, changes, new Set([1]))).toBe(["one", "two", "three", "four", "five", "SIX"].join("\n"));
  });

  it("matches the new text once every change was seen", () => {
    expect(reviewWithSeen(before, after, changes, new Set([0, 1]))).toBe(after);
  });

  it("stays the old text while nothing was seen", () => {
    expect(reviewWithSeen(before, after, changes, new Set())).toBe(before);
  });

  it("handles a removed last line", () => {
    expect(reviewWithSeen("a\nb", "a", inlineChanges("a\nb", "a"), new Set([0]))).toBe("a");
  });
});

describe("deciding a change was read", () => {
  const view = { viewTop: 0, viewBottom: 800, looking: true };
  const start = { since: null, covered: [] };
  const look = (track: object, top: number, bottom: number, now: number, extra = {}) =>
    lookAt(track, { top, bottom, now, ...view, ...extra }, 3000) as { since: number | null; covered: number[][]; seen: boolean };

  it("gives a long change its whole reading time, with no cap", () => {
    expect(readingTime(100)).toBe(readingTime(0) + 100 * (readingTime(1) - readingTime(0)));
  });

  it("counts a short change as read once it stayed on screen for its reading time", () => {
    const first = look(start, 100, 130, 0);

    expect(look(first, 100, 130, 2999).seen).toBe(false);
    expect(look(first, 100, 130, 3000).seen).toBe(true);
  });

  it("starts over when the change leaves the screen, so a flick past it is no read", () => {
    const first = look(start, 100, 130, 0);
    const gone = look(first, -500, -470, 1000);

    expect(look(gone, 100, 130, 3500).seen).toBe(false);
  });

  it("does not count a change that only peeks onto the screen", () => {
    expect(look(start, 790, 830, 0).since).toBeNull();
  });

  it("does not count time while the reader is in another window", () => {
    expect(look(start, 100, 130, 0, { looking: false }).since).toBeNull();
  });

  it("needs every part of a change taller than the screen to have been on screen", () => {
    let track = look(start, 0, 2400, 0);
    track = look(track, 0, 2400, 60_000);
    expect(track.seen).toBe(false);

    track = look(track, -800, 1600, 61_000);
    track = look(track, -1600, 800, 62_000);
    expect(track.seen).toBe(true);
  });

  it("needs the top of a tall change too, not only from its middle down", () => {
    let track = look(start, -400, 2000, 0);
    track = look(track, -1000, 1400, 1000);
    track = look(track, -1600, 800, 30_000);

    expect(track.covered).toEqual([[400, 2400]]);
    expect(track.seen).toBe(false);
  });

  it("notices a part that was skipped in a jump", () => {
    let track = look(start, 0, 2400, 0);
    track = look(track, -1600, 800, 10_000);

    expect(track.seen).toBe(false);
  });
});

describe("undoing a change someone else made", () => {
  const lines = (...items: string[]) => items.join("\n");

  it("takes the undone text into a review that had seen everything", () => {
    expect(undoIntoReview(lines("a", "AI", "c"), lines("a", "AI", "c"), lines("a", "b", "c"))).toBe(lines("a", "b", "c"));
  });

  it("takes the undone text where only part of the AI's write had been seen", () => {
    const reviewed = lines("1", "AI one", "3", "4", "old five");
    const before = lines("1", "AI one", "3", "4", "AI five");
    const after = lines("1", "one", "3", "4", "old five");

    expect(undoIntoReview(reviewed, before, after)).toBe(after);
  });

  it("keeps an unseen change the undo did not touch", () => {
    const reviewed = lines("1", "AI one", "3", "old four", "5");
    const before = lines("1", "AI one", "3", "AI four", "5");
    const after = lines("1", "one", "3", "AI four", "5");

    expect(undoIntoReview(reviewed, before, after)).toBe(lines("1", "one", "3", "old four", "5"));
  });

  it("takes along an unseen change right next to the undo, without breaking the review", () => {
    const reviewed = lines("1", "old2", "AI3", "4");
    const before = lines("1", "AI2", "AI3", "4");
    const after = lines("1", "AI2", "3", "4");

    expect(undoIntoReview(reviewed, before, after)).toBe(after);
  });

  it("takes along an unseen change right after the undo too", () => {
    const reviewed = lines("1", "AI2", "old3", "4");
    const before = lines("1", "AI2", "AI3", "4");
    const after = lines("1", "2", "AI3", "4");

    expect(undoIntoReview(reviewed, before, after)).toBe(after);
  });

  it("undoes the second of two unseen writes at the start of a note without breaking the review", () => {
    expect(undoIntoReview(lines("o1", "o2", "3"), lines("X1", "X2", "3"), lines("X1", "o2", "3"))).toBe(lines("X1", "o2", "3"));
  });

  it("merges spans that meet once widened, so no line is put in twice", () => {
    expect(undoIntoReview(lines("x", "4", "y"), lines("x", "4", "3", "y"), lines("x", "3", "3", "y"))).toBe(lines("x", "3", "3", "y"));
  });

  it("takes two undone lines next to each other as one", () => {
    const reviewed = lines("1", "AI2", "AI3", "4");

    expect(undoIntoReview(reviewed, reviewed, lines("1", "2", "3", "4"))).toBe(lines("1", "2", "3", "4"));
  });

  it("changes nothing when the undo only brings back what the review still had", () => {
    const reviewed = lines("1", "old", "3");

    expect(undoIntoReview(reviewed, lines("1", "AI", "3"), reviewed)).toBe(reviewed);
  });
});

describe("keeping read changes on screen while the diff is rebuilt", () => {
  const lines = (...items: string[]) => items.join("\n");
  const base = lines("one", "two", "three", "four", "five", "six");
  const now = lines("ONE", "two", "three", "four", "five", "SIX");

  it("knows which changes the review already took", () => {
    const reviewed = lines("ONE", "two", "three", "four", "five", "six");

    expect([...alreadyRead(inlineChanges(base, now), reviewed, now)]).toEqual([0]);
  });

  it("knows none were taken while the review is the old text", () => {
    expect([...alreadyRead(inlineChanges(base, now), base, now)]).toEqual([]);
  });

  it("knows an unread removal is not read", () => {
    expect([...alreadyRead(inlineChanges("a\nb\nc", "a\nc"), "a\nb\nc", "a\nc")]).toEqual([]);
  });

  it("keeps a read change still on screen when the AI writes somewhere else", () => {
    const reviewed = lines("ONE", "two", "three", "four", "five", "six");
    const later = lines("ONE", "two", "three", "four", "five", "SIX");

    const { before, read } = rebuiltChanges(reviewed, later, base);

    expect(before).toBe(base);
    expect([...read]).toEqual([0]);
  });

  it("starts from the review when the AI rewrote the read change itself", () => {
    const reviewed = lines("Intro line one", "", "Body text here", "", "AI paragraph added at the end");
    const lingering = lines("Intro line one", "", "Body text here");
    const later = lines("Intro line ONE was changed", "", "Body text here");

    const { before, changes, read } = rebuiltChanges(reviewed, later, lingering);

    expect(before).toBe(reviewed);
    expect(read.size).toBe(0);
    expect(reviewWithSeen(before, later, changes, new Set(changes.map((_: unknown, i: number) => i)))).toBe(later);
  });

  it("leaves another device's typing out of the dimmed changes once it is folded into the lingering text", () => {
    const lingering = lines("one", "two", "three", "four", "five", "six");
    const shown = lines("ONE", "two", "three", "four", "five", "six");
    const typed = lines("ONE", "two", "three", "four", "five", "six and mine");

    const { changes, read } = rebuiltChanges(typed, typed, undoIntoReview(lingering, shown, typed));

    expect(changes).toHaveLength(1);
    expect([...read]).toEqual([0]);
  });

  it("starts from the review when nothing read is left on screen", () => {
    expect(rebuiltChanges(base, now, null).before).toBe(base);
  });
});

describe("comparing texts that take too long", () => {
  // No line in common, so comparing them runs into the time limit.
  const unrelated = (tag: string) => Array.from({ length: 20_000 }, (_, i) => `${tag} line ${i}`).join("\n");
  const reviewed = unrelated("old");
  const now = unrelated("new");

  it("keeps the review as it was instead of taking the whole text", () => {
    expect(undoIntoReview(reviewed, now, `${now}\nmore`)).toBe(reviewed);
  });

  it("counts nothing as read", () => {
    expect(alreadyRead([{ oldFrom: 0, oldTo: 1, newFrom: 0, newTo: 1 }] as never, reviewed, now).size).toBe(0);
  });
});
