import { describe, expect, it } from "bun:test";
import { mergeState } from "./sync.js";

const mark = (id: string, offset = 0) => ({ id, offset, before: "", after: id });
const history = (hash: string, done: unknown[] = []) => ({ done, undone: [], hash });
const state = (marks: unknown[], reviewed: string, hash: string) => ({ marks, reviewed, history: history(hash) });
const synced = (local: unknown, remote: unknown) => ({ local, remote });

describe("merging what this device has with what the server has", () => {
  const start = state([mark("a")], "text", "h1");

  it("sends what this device has when the server has nothing yet", () => {
    expect(mergeState(null, start, null, false)).toEqual(start);
  });

  it("keeps a mark added on another device when this device adds one", () => {
    const here = { ...start, marks: [mark("a"), mark("here")] };
    const there = { ...start, marks: [mark("a"), mark("there")] };

    const merged = mergeState(synced(start, start), here, there, false);

    expect(merged.marks.map(({ id }: { id: string }) => id).sort()).toEqual(["a", "here", "there"]);
  });

  it("removes a mark removed here even though the server still has it", () => {
    const here = { ...start, marks: [] };

    expect(mergeState(synced(start, start), here, start, false).marks).toEqual([]);
  });

  it("does not bring back a mark another device removed", () => {
    const there = { ...start, marks: [] };

    expect(mergeState(synced(start, start), start, there, false).marks).toEqual([]);
  });

  it("uses this device's position for a mark both sides still have", () => {
    const here = { ...start, marks: [mark("a", 9)] };

    expect(mergeState(synced(start, start), here, start, false).marks).toEqual([mark("a", 9)]);
  });

  it("keeps a review from another device when this device only added a mark", () => {
    const here = { ...start, marks: [mark("a"), mark("here")] };
    const there = { ...start, reviewed: "reviewed there" };

    expect(mergeState(synced(start, start), here, there, false).reviewed).toBe("reviewed there");
  });

  it("keeps undo steps from another device that has moved the text on", () => {
    const there = { ...start, history: history("h2", ["their step"]) };

    expect(mergeState(synced(start, start), start, there, false).history).toEqual(there.history);
  });

  it("sends a review made here when nothing changed on the server", () => {
    const here = { ...start, reviewed: "reviewed here" };

    expect(mergeState(synced(start, start), here, start, false).reviewed).toBe("reviewed here");
  });

  it("keeps the server's text-tied state when both sides changed it", () => {
    const here = { ...start, reviewed: "here", history: history("h-here", ["mine"]) };
    const there = { ...start, reviewed: "there", history: history("h-there", ["theirs"]) };

    const merged = mergeState(synced(start, start), here, there, false);

    expect(merged.reviewed).toBe("there");
    expect(merged.history).toEqual(there.history);
  });

  it("holds back undo steps and the review while this device's text is in conflict, but still shares marks", () => {
    const here = { marks: [mark("a"), mark("here")], reviewed: "here", history: history("h-here", ["mine"]) };

    const merged = mergeState(synced(start, start), here, start, true);

    expect(merged.reviewed).toBe("text");
    expect(merged.history).toEqual(start.history);
    expect(merged.marks.map(({ id }: { id: string }) => id)).toEqual(["a", "here"]);
  });

  it("finds a change made in place in the undo steps of an earlier copy", () => {
    const here = { ...start, history: history("h2", ["new step"]) };

    expect(mergeState(synced(start, start), here, start, false).history).toEqual(here.history);
  });

  it("does not bring back a removed mark when an old copy of this device still has it", () => {
    const stale = synced(state([], "text", "h1"), state([], "text", "h1"));
    const there = { ...state([], "text", "h1"), removedMarks: ["here"] };
    const here = state([mark("here")], "text", "h1");

    expect(mergeState(stale, here, there, false).marks).toEqual([]);
  });

  it("remembers marks removed here, so old copies elsewhere can't bring them back", () => {
    const here = { ...start, marks: [], removedMarks: ["a"] };

    expect(mergeState(synced(start, start), here, start, false).removedMarks).toEqual(["a"]);
  });

  it("does not remember a mark that only merged into another when its text was deleted", () => {
    const here = { ...start, marks: [] };

    expect(mergeState(synced(start, start), here, start, false).removedMarks).toEqual([]);
  });

  it("forgets the oldest removed marks past a limit", () => {
    const old = Array.from({ length: 200 }, (_, i) => `old${i}`);
    const there = { ...start, marks: [mark("a")], removedMarks: old };
    const here = { ...start, marks: [], removedMarks: ["a"] };

    const { removedMarks } = mergeState(synced(start, there), here, there, false);

    expect(removedMarks).toHaveLength(200);
    expect(removedMarks.at(-1)).toBe("a");
  });

  it("treats a mark with no id by its context, so devices agree which mark it is", () => {
    const old = { offset: 3, before: "ab", after: "cd" };
    const base = state([old], "text", "h1");
    const here = { ...base, marks: [{ ...old, offset: 8 }] };

    expect(mergeState(synced(base, base), here, base, false).marks).toHaveLength(1);
  });
});
