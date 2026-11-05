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

  it("puts each table in its own sideways scroller and marks long and very long cells", () => {
    const long = "[TaCZ] Timeless and Classics Zero";
    const longer = "Cảnh rừng thu lãng mạn, gió thổi lá rụng bay lượn: bộ sprite lá phong đỏ rực, lá sồi vàng, cánh hoa anh đào rơi";
    const html = renderNote(`| Gói | Lượt | Công dụng |\n| - | - | - |\n| ${long} | 28.0M | ${longer} |\n`);

    expect(html).toMatch(/^<div class="table-scroll"><table[^>]*>[\s\S]*<\/table>\n<\/div>\n$/);
    expect(html).toContain(`<td class="long">${long}</td>`);
    expect(html).toContain(`<td class="longer">${longer}</td>`);
    expect(html).toContain("<td>28.0M</td>");
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
