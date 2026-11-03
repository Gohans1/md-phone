const fold = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();

// Searching the folded text needs a way back: each folded character remembers where it came from.
function foldWithOffsets(text) {
  let folded = "";
  const offsets = [];
  let at = 0;
  for (const char of text) {
    // Plain ASCII needs no normalizing, and it is most of a note.
    const part = char.charCodeAt(0) < 0x80 ? char.toLowerCase() : fold(char);
    folded += part;
    for (let i = 0; i < part.length; i++) offsets.push(at);
    at += char.length;
  }
  offsets.push(at);
  return { folded, offsets };
}

// Each keystroke in the search bar searches the same note again.
let lastFolded = null;

// Typing without marks finds Vietnamese text, since marks are slow to type on a phone.
export function findMatches(text, query) {
  const needle = fold(query);
  if (!needle) return [];
  if (lastFolded?.text !== text) lastFolded = { text, ...foldWithOffsets(text) };
  const { folded, offsets } = lastFolded;
  const matches = [];
  for (let at = folded.indexOf(needle); at !== -1; at = folded.indexOf(needle, at + needle.length)) {
    matches.push({ start: offsets[at], end: offsets[at + needle.length] });
  }
  return matches;
}
