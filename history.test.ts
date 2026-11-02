import { describe, expect, it } from "bun:test";
import { createHistory, hashText, record, redo, undo } from "./history.js";

// Applies the change undo or redo asks for, the way the editor does.
const apply = (text: string, change: { start: number; end: number; text: string }) =>
  text.slice(0, change.start) + change.text + text.slice(change.end);

function replay(texts: string[], gapMs = 5000) {
  const history = createHistory(texts[0]!);
  texts.slice(1).forEach((text, i) => record(history, text, (i + 1) * gapMs));
  return history;
}

function undoAll(history: ReturnType<typeof createHistory>) {
  let text = history.text;
  for (let change = undo(history); change; change = undo(history)) text = apply(text, change);
  return text;
}

describe("undo and redo", () => {
  it("brings back a deleted block in one step", () => {
    const start = "# Title\n\nline one\nline two\n\nend";
    const history = replay([start, "# Title\n\nend"]);

    const change = undo(history)!;

    expect(apply("# Title\n\nend", change)).toBe(start);
    expect(history.text).toBe(start);
  });

  it("puts the deletion back with redo", () => {
    const history = replay(["a\nb\nc", "a\nc"]);
    const undone = apply("a\nc", undo(history)!);

    const change = redo(history)!;

    expect(apply(undone, change)).toBe("a\nc");
    expect(history.text).toBe("a\nc");
  });

  it("walks back through every step and forward again", () => {
    const texts = ["one", "one two", "one two three", "one three"];
    const history = replay(texts);

    expect(undoAll(history)).toBe("one");

    let text = "one";
    for (const expected of texts.slice(1)) {
      text = apply(text, redo(history)!);
      expect(text).toBe(expected);
    }
    expect(redo(history)).toBeNull();
  });

  it("has nothing to undo or redo on a fresh note", () => {
    const history = createHistory("text");

    expect(undo(history)).toBeNull();
    expect(redo(history)).toBeNull();
  });

  it("forgets the redo steps once new text is typed", () => {
    const history = replay(["a", "ab"]);
    undo(history);

    record(history, "ac", 99999);

    expect(redo(history)).toBeNull();
  });

  it("puts the caret after the restored text", () => {
    const history = replay(["keep gone end", "keep  end"]);

    expect(undo(history)!.caret).toBe("keep gone".length);
  });
});

describe("grouping keystrokes into steps", () => {
  const typeAt = (history: ReturnType<typeof createHistory>, texts: string[], from: number) =>
    texts.forEach((text, i) => record(history, text, from + i * 100));

  it("undoes a burst of typing as one step", () => {
    const history = createHistory("");

    typeAt(history, ["h", "he", "hel", "hell", "hello"], 1000);

    expect(undoAll(history)).toBe("");
    expect(history.done).toHaveLength(0);
    expect(history.undone).toHaveLength(1);
  });

  it("starts a new step after a pause", () => {
    const history = createHistory("");

    record(history, "a", 1000);
    record(history, "ab", 9000);

    expect(history.done).toHaveLength(2);
  });

  it("keeps a word the keyboard rewrites while composing as one step", () => {
    const history = createHistory("");

    typeAt(history, ["v", "vi", "viê", "việ", "việt"], 1000);

    expect(history.done).toHaveLength(1);
    expect(undoAll(history)).toBe("");
  });

  it("undoes a burst of backspaces as one step", () => {
    const history = createHistory("hello");

    typeAt(history, ["hell", "hel", "he"], 1000);

    expect(history.done).toHaveLength(1);
    expect(undoAll(history)).toBe("hello");
  });

  it("never merges a block deletion with the typing around it", () => {
    const history = createHistory("a\nb\nc");

    record(history, "a\nc", 1000);
    record(history, "a\ncx", 1100);

    expect(history.done).toHaveLength(2);
  });

  it("makes a new line its own step", () => {
    const history = createHistory("");

    record(history, "a", 1000);
    record(history, "a\n", 1100);
    record(history, "a\nb", 1200);

    expect(history.done).toHaveLength(3);
  });

  it("keeps a change from the PC separate from typing just before it", () => {
    const history = createHistory("a");

    record(history, "ab", 1000);
    record(history, "abc", 1100, { separate: true });

    expect(history.done).toHaveLength(2);
  });
});

describe("limits", () => {
  it("drops the oldest steps first", () => {
    const history = createHistory("");
    for (let i = 1; i <= 150; i++) record(history, "x".repeat(i), i * 5000);

    expect(history.done.length).toBeLessThanOrEqual(100);
    expect(history.done.at(-1)).toMatchObject({ inserted: "x" });
  });

  it("keeps a huge deletion even when it alone is over the size limit", () => {
    const big = "line\n".repeat(100000);
    const history = createHistory(big);

    record(history, "", 1000);

    expect(history.done).toHaveLength(1);
    expect(apply("", undo(history)!)).toBe(big);
  });
});

describe("hashText", () => {
  it("tells different texts apart", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
  });
});
