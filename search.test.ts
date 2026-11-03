import { describe, expect, it } from "bun:test";
import { findMatches } from "./search.js";

const found = (text: string, query: string) =>
  (findMatches(text, query) as { start: number; end: number }[]).map(({ start, end }) => text.slice(start, end));

describe("finding text in a note", () => {
  it("finds every copy, ignoring case", () => {
    expect(found("Hero hero HERO", "hero")).toEqual(["Hero", "hero", "HERO"]);
  });

  it("finds Vietnamese text typed without its marks", () => {
    expect(found("Kịch bản và kich ban", "kich ban")).toEqual(["Kịch bản", "kich ban"]);
  });

  it("finds đ when typing d, and the reverse", () => {
    expect(found("Đường duong", "duong")).toEqual(["Đường", "duong"]);
    expect(found("duong", "đường")).toEqual(["duong"]);
  });

  it("keeps a decomposed mark inside the match", () => {
    const text = "bản".normalize("NFD");

    expect(found(text, "ban")).toEqual([text]);
  });

  it("gives offsets in the original text after marks that fold away", () => {
    const text = `${"ề".normalize("NFD")} x`;

    expect(findMatches(text, "x")).toEqual([{ start: text.length - 1, end: text.length }]);
  });

  it("does not overlap matches", () => {
    expect(findMatches("aaaa", "aa")).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  });

  it("finds across a line break", () => {
    expect(found("one\ntwo", "e\nt")).toEqual(["e\nt"]);
  });

  it("finds nothing for an empty query or one that folds to nothing", () => {
    expect(findMatches("text", "")).toEqual([]);
    expect(findMatches("text", "́")).toEqual([]);
  });

  it("treats regular expression characters as plain text", () => {
    expect(found("a.b axb", "a.b")).toEqual(["a.b"]);
  });
});
