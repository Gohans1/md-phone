import { describe, expect, it } from "bun:test";
import { parseHeadings } from "./headings.js";

const titles = (text: string) => parseHeadings(text).map((h) => h.title);

describe("finding headings", () => {
  it("reads the level and title of each heading", () => {
    expect(parseHeadings("# One\n\ntext\n\n### Three")).toEqual([
      { level: 1, title: "One", offset: 0, line: 0, bullets: 0 },
      { level: 3, title: "Three", offset: 13, line: 4, bullets: 0 },
    ]);
  });

  it("points each offset at the start of the heading's line", () => {
    const text = "intro\n## Two\nbody\n   # Indented";

    for (const { offset, title } of parseHeadings(text)) {
      expect(text.slice(offset).split("\n")[0]).toContain(title);
      expect(offset === 0 || text[offset - 1] === "\n").toBe(true);
    }
  });

  it("ignores lines that only look like headings", () => {
    expect(titles("#no-space\n####### seven\n    # indented code\n\\# escaped\n#")).toEqual([]);
  });

  it("drops the closing hashes but keeps a hash inside the title", () => {
    expect(titles("## Two ##\n# C#")).toEqual(["Two", "C#"]);
  });

  it("shows titles without Markdown marks", () => {
    expect(titles("# **Bold** and `code` with [a link](https://x.dev)")).toEqual(["Bold and code with a link"]);
  });

  it("keeps underscores in names like snake_case", () => {
    expect(titles("# my_file_name")).toEqual(["my_file_name"]);
  });

  it("finds headings underlined with = or -", () => {
    expect(parseHeadings("Big\n===\n\nSmall\n---")).toEqual([
      { level: 1, title: "Big", offset: 0, line: 0, bullets: 0 },
      { level: 2, title: "Small", offset: 9, line: 3, bullets: 0 },
    ]);
  });

  it("does not treat a divider as a heading", () => {
    expect(titles("text\n\n---\n\n- item\n---")).toEqual([]);
  });
});

describe("a note that starts with a byte order mark", () => {
  it("still finds its first heading", () => {
    expect(titles("\uFEFF# First\n\n## Second\n")).toEqual(["First", "Second"]);
  });

  it("still skips its front matter", () => {
    expect(titles("\uFEFF---\ntitle: x\n---\n# Real\n")).toEqual(["Real"]);
  });
});

describe("counting bullet points", () => {
  const bullets = (text: string) => parseHeadings(text).map((h) => h.bullets);

  it("counts each heading's own bullets, until the next heading of any level", () => {
    expect(bullets("# A\n- one\n- two\n## B\n* three\n# C\ntext")).toEqual([2, 1, 0]);
  });

  it("counts nested bullets and all three bullet markers", () => {
    expect(bullets("# A\n- one\n  - two\n    + three\n* four")).toEqual([4]);
  });

  it("does not count numbered lists, dividers, or a marker with no text", () => {
    expect(bullets("# A\n1. one\n---\n* * *\n- - -\n-\n-no space")).toEqual([0]);
  });

  it("does not count bullets inside fenced code", () => {
    expect(bullets("# A\n```\n- code\n```\n- real")).toEqual([1]);
  });

  it("leaves out bullets above the first heading", () => {
    expect(bullets("- loose\n# A\n- real")).toEqual([1]);
  });
});

describe("skipping what is not prose", () => {
  it("ignores comments inside fenced code", () => {
    expect(titles("# Real\n```bash\n# comment\n```\n~~~\n# also\n~~~\n# After")).toEqual(["Real", "After"]);
  });

  it("only closes a fence with the same marker, at least as long", () => {
    expect(titles("````\n```\n# inside\n````\n# After")).toEqual(["After"]);
  });

  it("treats everything after an unclosed fence as code", () => {
    expect(titles("# Before\n```\n# inside")).toEqual(["Before"]);
  });

  it("ignores frontmatter at the top of the file", () => {
    const text = "---\n# comment\nname: skill\n---\n# Title";

    expect(parseHeadings(text)).toEqual([{ level: 1, title: "Title", offset: text.indexOf("# Title"), line: 4, bullets: 0 }]);
  });

  it("reads an unclosed leading --- as a plain document", () => {
    expect(titles("---\n# Title")).toEqual(["Title"]);
  });
});
