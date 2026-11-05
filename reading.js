import { MarkdownIt } from "./vendor/markdown-it.js";

// Blocks that carry the line they start on, so switching between reading and editing keeps the place.
const BLOCKS = ["paragraph_open", "heading_open", "bullet_list_open", "ordered_list_open", "blockquote_open", "table_open", "hr", "code_block", "fence"];

const LONG_CELL_CHARS = 30;
const LONGER_CELL_CHARS = 100;

let parser = null;

function makeParser() {
  // html stays off: Markdown written in a note is shown, never run.
  const md = new MarkdownIt({ html: false, linkify: true });
  const plain = (tokens, i, options, env, self) => self.renderToken(tokens, i, options);
  for (const rule of BLOCKS) {
    const render = md.renderer.rules[rule] ?? plain;
    md.renderer.rules[rule] = (tokens, i, options, env, self) => {
      if (tokens[i].map) tokens[i].attrSet("data-line", String(tokens[i].map[0]));
      return render(tokens, i, options, env, self);
    };
  }
  const openLink = md.renderer.rules.link_open ?? plain;
  md.renderer.rules.link_open = (tokens, i, options, env, self) => {
    tokens[i].attrSet("target", "_blank");
    tokens[i].attrSet("rel", "noopener noreferrer");
    return openLink(tokens, i, options, env, self);
  };
  // A table may grow wider than the text column, so it scrolls sideways in a box of its own.
  const openTable = md.renderer.rules.table_open;
  md.renderer.rules.table_open = (...args) => `<div class="table-scroll">${openTable(...args)}`;
  md.renderer.rules.table_close = (tokens, i, options, env, self) => `${self.renderToken(tokens, i, options)}</div>\n`;
  // CSS can't tell a long cell from a short one, and a long one squeezed to its longest word reads as a tall thin strip.
  md.renderer.rules.td_open = (tokens, i, options, env, self) => {
    const chars = tokens[i + 1].content.length;
    if (chars > LONGER_CELL_CHARS) tokens[i].attrJoin("class", "longer");
    else if (chars > LONG_CELL_CHARS) tokens[i].attrJoin("class", "long");
    return self.renderToken(tokens, i, options);
  };
  return md;
}

export function renderNote(text) {
  parser ??= makeParser();
  return parser.render(text);
}
