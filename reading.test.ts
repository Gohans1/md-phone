import { describe, expect, it } from "bun:test";
import { renderNote } from "./reading.js";

describe("reading a note as formatted Markdown", () => {
  it("formats headings, emphasis and lists", () => {
    const html = renderNote("# Cảnh 1\n\nMột câu **đậm** và *nghiêng*.\n\n- một\n- hai\n");

    expect(html).toContain(">Cảnh 1</h1>");
    expect(html).toContain("<strong>đậm</strong>");
    expect(html).toContain("<em>nghiêng</em>");
    expect(html).toContain("<li");
  });

  it("formats tables and struck-out text", () => {
    const html = renderNote("| a | b |\n| - | - |\n| 1 | 2 |\n\n~~cũ~~\n");

    expect(html).toContain("<table");
    expect(html).toContain("<s>cũ</s>");
  });

  it("shows HTML written in the note as text instead of running it", () => {
    const html = renderNote('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n');

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });

  it("never makes a link that runs code", () => {
    expect(renderNote("[bấm](javascript:alert(1))")).not.toContain("href=\"javascript");
  });

  it("opens links in a new tab without handing it this page", () => {
    expect(renderNote("[docs](https://example.com)")).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it("marks each block with the line it starts on, so switching views keeps the place", () => {
    const html = renderNote("# A\n\npara\n\n## B\n\n- item\n");

    expect(html).toContain('<h1 data-line="0"');
    expect(html).toContain('<p data-line="2"');
    expect(html).toContain('<h2 data-line="4"');
    expect(html).toContain('<ul data-line="6"');
  });
});
