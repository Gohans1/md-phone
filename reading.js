import { MarkdownIt } from "./vendor/markdown-it.js";

// Blocks that carry the line they start on, so switching between reading and editing keeps the place.
const BLOCKS = ["paragraph_open", "heading_open", "bullet_list_open", "ordered_list_open", "blockquote_open", "table_open", "hr", "code_block", "fence"];

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
  return md;
}

export function renderNote(text) {
  parser ??= makeParser();
  return parser.render(text);
}
