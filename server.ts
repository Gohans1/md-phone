import { lstat, mkdir, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const PORT = 4380;
const INDEX = join(import.meta.dir, "index.html");
const CLIENT_MODULES = new Set(["/changes.js", "/headings.js", "/history.js", "/marks.js", "/reading.js", "/search.js", "/sync.js", "/vendor/diff.js", "/vendor/markdown-it.js"]);
const FONTS = new Set(["latin", "latin-ext", "vietnamese"].map((subset) => `/vendor/fonts/inter-${subset}-wght-normal.woff2`));
const HIDDEN_DIRS = new Set(["node_modules"]);
const STATE_KINDS = new Set(["note", "scroll"]);
// Other files are only shown as plain text, and a phone gains nothing from megabytes of it.
const RAW_MAX_BYTES = 2_000_000;
// Windows refuses to replace a file another program has open for a moment.
const BUSY_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);
// Characters Windows forbids in a file name, direction marks that make a name read differently than it is,
// and Windows device names, which it also finds behind spaces or dots and with superscript digits.
const BAD_NAME = /[<>:"/\\|?*\p{Cc}\u200E\u200F\u202A-\u202E\u2066-\u2069]|^\.|^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$|clock\$)[ .]*(\.|$)/iu;

const NO_SNIFF = { "X-Content-Type-Options": "nosniff" };
const NO_STORE = { "Cache-Control": "no-store", ...NO_SNIFF };
// The page must not run inside another site's frame, where a lure could guide clicks on Discard or Mark as reviewed.
const PAGE_HEADERS = {
  "Cache-Control": "no-cache",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  ...NO_SNIFF,
};
// A web page can point its own name at this server (DNS rebinding) and become same-origin with it,
// so only this machine's names and the tailnet's are answered.
const OWN_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$|\.ts\.net(:\d+)?$/i;
// The page keeps a byte order mark as text, so a comparison with what it saved must too.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const versionOf = (bytes: Uint8Array) => `"${Bun.hash(bytes).toString(36)}"`;
const notePath = (root: string, parts: string[]) => "/" + [root, ...parts].map(encodeURIComponent).join("/");
const stateFile = (dir: string, kind: string, note: string) =>
  join(dir, `${new Bun.CryptoHasher("sha256").update(`${kind}:${note}`).digest("hex")}.json`);
const status = (code: number, message: string) => new Response(message, { status: code });

class UnreadableUpload extends Error {}

// The page gzips big uploads, since a phone's link to the PC can be slow.
async function readBody(req: Request) {
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (req.headers.get("Content-Encoding") !== "gzip") return bytes;
  try {
    return Bun.gunzipSync(bytes);
  } catch {
    throw new UnreadableUpload();
  }
}

// The page and its modules, read and compressed once per version of the file, answered with 304 while unchanged.
const prepared = new Map<string, { stamp: string; plain: Uint8Array<ArrayBuffer>; packed: Uint8Array<ArrayBuffer>; tag: string }>();

async function serveFile(path: string, req: Request, headers: Record<string, string>) {
  const file = Bun.file(path);
  const stamp = `${file.lastModified}:${file.size}`;
  let entry = prepared.get(path);
  if (entry?.stamp !== stamp) {
    const plain = await file.bytes();
    entry = { stamp, plain, packed: Bun.gzipSync(plain) as Uint8Array<ArrayBuffer>, tag: Bun.hash(plain).toString(36) };
    prepared.set(path, entry);
  }
  const packs = /\bgzip\b/.test(req.headers.get("Accept-Encoding") ?? "");
  const tag = `"${entry.tag}${packs ? "-gz" : ""}"`;
  const all = { ...headers, "Content-Type": file.type, ETag: tag, Vary: "Accept-Encoding" };
  if (req.headers.get("If-None-Match") === tag) return new Response(null, { status: 304, headers: all });
  return new Response(packs ? entry.packed : entry.plain, { headers: packs ? { ...all, "Content-Encoding": "gzip" } : all });
}

// A note and its state go gzipped too. Their ETag names the PC's version of the file, which a save's If-Match is checked
// against, so it stays the same for both encodings; both answers are no-store, so no cache can mix them up.
const PACK_MIN_BYTES = 1024;

function sendPacked(bytes: Uint8Array<ArrayBuffer>, req: Request, headers: Record<string, string>) {
  const all = { ...headers, Vary: "Accept-Encoding" };
  if (bytes.length < PACK_MIN_BYTES || !/\bgzip\b/.test(req.headers.get("Accept-Encoding") ?? "")) return new Response(bytes, { headers: all });
  return new Response(Bun.gzipSync(bytes, { level: 4 }) as Uint8Array<ArrayBuffer>, { headers: { ...all, "Content-Encoding": "gzip" } });
}

async function locate(rootDir: string, path: string): Promise<string | null> {
  // A colon selects an NTFS alternate data stream or another drive, and a leading slash a root or, on Windows,
  // another computer (\\host\share), which Windows would contact and send its login to before any check below.
  if (path.includes(":") || /^[\\/]/.test(path)) return null;
  const base = await realpath(rootDir);
  const escapes = (inside: string) => inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside);
  // Checked by name first, so a path outside never reaches the disk; then again once links are followed.
  const named = resolve(base, path);
  if (escapes(relative(base, named))) return null;
  const target = await realpath(named);
  return escapes(relative(base, target)) ? null : target;
}

const queues = new Map<string, Promise<unknown>>();

// Checking a version and then writing is only safe if no other request for the same file runs in between.
function oneAtATime<T>(key: string, work: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(work);
  const settled = run.catch(() => {});
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return run;
}

function lockPaths<T>(keys: string[], work: () => Promise<T>): Promise<T> {
  return [...new Set(keys)].sort().reduceRight<() => Promise<T>>(
    (next, key) => () => oneAtATime(key, next),
    work,
  )();
}

// `stillSafe` runs right before each attempt, because writing the temporary file and waiting for a busy file take time.
async function replaceFile(path: string, bytes: Uint8Array, stillSafe: () => Promise<boolean> = async () => true) {
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temp, bytes);
  try {
    for (let attempt = 0; ; attempt++) {
      if (!(await stillSafe())) return false;
      try {
        await rename(temp, path);
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (!BUSY_CODES.has(code)) throw error;
        if (attempt === 4) {
          // shortcut: a program in WSL holding the file open blocks replacing it from Windows for as long as it runs,
          // so this writes in place: not atomic, but the phone keeps its draft until the save succeeds.
          await writeFile(path, bytes);
          return true;
        }
        await Bun.sleep(100);
      }
    }
  } finally {
    await unlink(temp).catch(() => {});
  }
}

// The page keeps the copy of each note it last reviewed. Text that no longer matches it has changes nobody has looked at yet.
// It is only a hint, so anything unreadable counts as no changes.
// Answers are kept until the note or its state is written again, since a folder of long notes is slow to read on every visit.
const changedAnswers = new Map<string, { stamp: string; changed: boolean }>();

async function changedSinceReview(stateDir: string, note: string, path: string) {
  try {
    const statePath = stateFile(stateDir, "note", note);
    const state = Bun.file(statePath);
    if (!(await state.exists())) return false;
    const file = Bun.file(path);
    const stamp = `${state.lastModified}:${state.size}:${file.lastModified}:${file.size}`;
    const known = changedAnswers.get(statePath);
    if (known?.stamp === stamp) return known.changed;
    const { reviewed } = await state.json();
    // The page reads "\r\n" as "\n", and its copy was made from what it read.
    const changed = typeof reviewed === "string" && utf8.decode(await file.bytes()).replace(/\r\n?/g, "\n") !== reviewed;
    changedAnswers.set(statePath, { stamp, changed });
    return changed;
  } catch {
    return false;
  }
}

async function list(dir: string, note: (name: string) => string, stateDir: string, req: Request) {
  const entries = await readdir(dir, { withFileTypes: true });
  const names = (wanted: (entry: (typeof entries)[number]) => boolean) =>
    entries
      .filter(wanted)
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  const files = names((e) => e.isFile() && /\.md$/i.test(e.name));
  const others = names((e) => e.isFile() && !/\.md$/i.test(e.name) && !e.name.startsWith("."));
  const changed = await Promise.all(files.map((name) => changedSinceReview(stateDir, note(name), join(dir, name))));
  const body = JSON.stringify({
    dirs: names((e) => e.isDirectory() && !e.name.startsWith(".") && !HIDDEN_DIRS.has(e.name)),
    files,
    changed: files.filter((_, i) => changed[i]),
    others,
  });
  // A folder open on screen is asked again every few seconds, and usually nothing in it changed.
  const headers = { "Cache-Control": "no-cache", ...NO_SNIFF, ETag: versionOf(new TextEncoder().encode(body)) };
  if (req.headers.get("If-None-Match") === headers.ETag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, "Content-Type": "application/json;charset=utf-8" } });
}

async function handleChanged(req: Request, url: URL, stateDir: string, allowed: Record<string, string>) {
  if (req.method !== "GET") return status(405, "Method not allowed.");
  // A pin can outlive its folder in roots.json, and it must not hide the others' answers.
  const notes = url.searchParams.getAll("note").filter((note) => isNotePath(note, allowed));
  const changed = await Promise.all(notes.map(async (note) => {
    const [, root = "", ...parts] = note.split("/").map(decodeURIComponent);
    const path = await locate(allowed[root]!, parts.join("/")).catch(() => null);
    return path !== null && (await changedSinceReview(stateDir, note, path));
  }));
  return Response.json(notes.filter((_, i) => changed[i]), { headers: NO_STORE });
}

async function openFile(path: string, req: Request) {
  const bytes = await Bun.file(path).bytes();
  try {
    utf8.decode(bytes);
  } catch {
    return status(415, "This file is not UTF-8, so it stays closed to protect it. Convert it to UTF-8 on the PC, then open it again.");
  }
  const version = versionOf(bytes);
  const headers = { ...NO_STORE, ETag: version };
  if (req.headers.get("If-None-Match") === version) return new Response(null, { status: 304, headers });
  return sendPacked(bytes, req, { ...headers, "Content-Type": "text/markdown; charset=utf-8" });
}

async function openRaw(path: string, req: Request) {
  const info = await stat(path);
  if (!info.isFile()) return status(404, "File not found.");
  if (info.size > RAW_MAX_BYTES) return status(413, "This file is too big to show here. Open it on the PC.");
  const bytes = await Bun.file(path).bytes();
  try {
    utf8.decode(bytes);
  } catch {
    return status(415, "This file isn't text, so it can't be shown here. Open it on the PC.");
  }
  return sendPacked(bytes, req, { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" });
}

// shortcut: a program outside this server could still write between the last check and the rename (microseconds),
// closing that gap needs OS file locks the other writers do not take anyway.
async function saveFile(path: string, req: Request) {
  const expected = req.headers.get("If-Match");
  if (!expected) return status(428, "If-Match is required.");
  // The whole body comes first: on a slow connection the upload can outlast another program's write.
  const bytes = await readBody(req);
  return oneAtATime(path, async () => {
    const unchanged = async () => versionOf(await Bun.file(path).bytes()) === expected;
    if (!(await replaceFile(path, bytes, unchanged))) {
      return new Response(null, { status: 412, headers: { ...NO_STORE, ETag: versionOf(await Bun.file(path).bytes()) } });
    }
    return new Response(null, { headers: { ...NO_STORE, ETag: versionOf(bytes) } });
  });
}

function cleanNoteName(rawName: string): { name: string } | { error: Response } {
  const trimmed = rawName.trim();
  const name = /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
  if (!trimmed || BAD_NAME.test(name)) {
    return { error: status(400, 'Choose another name. Names can’t start with a dot or use < > : " / \\ | ? *') };
  }
  if (name.length > 255) return { error: status(400, "Choose a shorter name.") };
  return { name };
}

async function createFile(dir: string, rawName: string) {
  const cleaned = cleanNoteName(rawName);
  if ("error" in cleaned) return cleaned.error;
  const { name } = cleaned;
  try {
    await writeFile(join(dir, name), "", { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return status(409, "That name is already used here. Choose another.");
    throw error;
  }
  return Response.json({ name }, { status: 201, headers: NO_STORE });
}

async function renameFile(
  rootName: string,
  rootDir: string,
  target: string,
  rawName: string,
  pinsPath: string,
  stateDir: string,
) {
  const cleaned = cleanNoteName(rawName);
  if ("error" in cleaned) return cleaned.error;
  const { name } = cleaned;
  const dir = dirname(target);
  const oldName = basename(target);
  const dest = join(dir, name);
  const relDir = relative(await realpath(rootDir), dir);
  const folderParts = relDir ? relDir.split(sep) : [];
  const oldNote = notePath(rootName, [...folderParts, oldName]);
  const newNote = notePath(rootName, [...folderParts, name]);
  const stateMoves = oldNote === newNote
    ? []
    : [...STATE_KINDS].map((kind) => ({
        from: stateFile(stateDir, kind, oldNote),
        to: stateFile(stateDir, kind, newNote),
      }));
  const lockKeys = [
    target,
    dest,
    ...(oldNote === newNote ? [] : [pinsPath, ...stateMoves.flatMap(({ from, to }) => [from, to])]),
  ];

  return lockPaths(lockKeys, async () => {
    const fromStat = await lstat(target);
    if (!fromStat.isFile()) return status(404, "File not found.");

    if (name !== oldName) {
      const destStat = await lstat(dest).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      // Case-insensitive NTFS and WSL /mnt/c report the old file at `dest` when only letter case changes;
      // WSL /mnt/c keeps the caller's case in `realpath`, so inode equality must be checked too.
      const sameFile =
        destStat !== null &&
        destStat.isFile() &&
        ((fromStat.ino !== 0 && fromStat.ino === destStat.ino && fromStat.dev === destStat.dev) ||
          (await realpath(dest).catch(() => null)) === target);
      if (destStat !== null && !sameFile) {
        return status(409, "That name is already used here. Choose another.");
      }

      for (let attempt = 0; ; attempt++) {
        try {
          await rename(target, dest);
          break;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code ?? "";
          if (code === "EEXIST" || code === "ENOTEMPTY" || code === "EISDIR") {
            return status(409, "That name is already used here. Choose another.");
          }
          if (!BUSY_CODES.has(code)) throw error;
          if (attempt === 4) {
            return status(409, "Another program on the PC has this file open. Close it there and try again.");
          }
          await Bun.sleep(100);
        }
      }

      const currentPins = await readPins(pinsPath);
      if (currentPins.includes(oldNote)) {
        const updated = [...new Set(currentPins.map((saved) => (saved === oldNote ? newNote : saved)))];
        await replaceFile(pinsPath, new TextEncoder().encode(JSON.stringify(updated)));
      }

      for (const { from, to } of stateMoves) {
        changedAnswers.delete(from);
        changedAnswers.delete(to);
        const saved = Bun.file(from);
        if (await saved.exists()) {
          await replaceFile(to, await saved.bytes());
          await unlink(from).catch(() => {});
        } else {
          await unlink(to).catch(() => {});
        }
      }
    }

    return Response.json({ name }, { headers: NO_STORE });
  });
}

function describeRoot(name: string, dir: string) {
  const wsl = /^\\\\wsl(?:\.localhost|\$)\\[^\\]+(\\.*)?$/i.exec(dir);
  if (wsl) return { name, system: "WSL", path: (wsl[1] ?? "\\").replaceAll("\\", "/") };
  return { name, system: dir.startsWith("/") ? "Linux" : "Windows", path: dir };
}

// A pin is a note or a folder, and only the page knows which; either way it must sit in an allowed root.
function isPinPath(pin: string, allowed: Record<string, string>) {
  try {
    const [empty, root] = pin.split("/");
    decodeURIComponent(pin);
    return empty === "" && !!root && Object.hasOwn(allowed, decodeURIComponent(root));
  } catch {
    return false;
  }
}

function isNotePath(pin: string, allowed: Record<string, string>) {
  try {
    return isPinPath(pin, allowed) && /\.md$/i.test(decodeURIComponent(pin));
  } catch {
    return false;
  }
}

async function readPins(path: string): Promise<string[]> {
  const file = Bun.file(path);
  return (await file.exists()) ? file.json() : [];
}

// Each request changes one pin instead of sending the whole list, so a tab left open can't undo another device's pins.
async function changePin(path: string, pin: string, pinned: boolean) {
  await oneAtATime(path, async () => {
    const others = (await readPins(path)).filter((saved) => saved !== pin);
    await replaceFile(path, new TextEncoder().encode(JSON.stringify(pinned ? [...others, pin] : others)));
  });
  return new Response(null, { status: 204, headers: NO_STORE });
}

async function handlePins(req: Request, url: URL, path: string, allowed: Record<string, string>) {
  if (req.method === "GET") return Response.json(await readPins(path), { headers: NO_STORE });
  // PUT and DELETE, not POST: browsers must ask before sending them cross-site, and this server never agrees.
  if (req.method !== "PUT" && req.method !== "DELETE") return status(405, "Method not allowed.");
  const pin = url.searchParams.get("pin") ?? "";
  if (!isPinPath(pin, allowed)) return status(400, "Only files and folders in the allowed folders can be pinned.");
  return changePin(path, pin, req.method === "PUT");
}

// Only the page knows what this state means; the server just stores it, apart from reading the reviewed copy to flag changed notes.
// A note's path can't escape the folder once hashed.
async function handleState(req: Request, url: URL, dir: string, allowed: Record<string, string>) {
  if (req.method !== "GET" && req.method !== "PUT") return status(405, "Method not allowed.");
  const note = url.searchParams.get("note") ?? "";
  const kind = url.searchParams.get("kind") ?? "";
  if (!STATE_KINDS.has(kind) || !isNotePath(note, allowed)) return status(400, "Unknown note or kind.");
  const path = stateFile(dir, kind, note);
  if (req.method === "PUT") {
    const expected = req.headers.get("If-Match");
    const creating = req.headers.get("If-None-Match") === "*";
    // A reading position is only worth the last value, but marks and undo steps must never be replaced unseen.
    const guarded = kind === "note";
    if (guarded && !expected && !creating) return status(428, "If-Match or If-None-Match is required.");
    const bytes = await readBody(req);
    await mkdir(dir, { recursive: true });
    return oneAtATime(path, async () => {
      const current = async () => {
        const saved = Bun.file(path);
        return (await saved.exists()) ? versionOf(await saved.bytes()) : null;
      };
      const unchanged = async () => !guarded || (await current()) === (creating ? null : expected);
      if (!(await replaceFile(path, bytes, unchanged))) {
        const version = await current();
        return new Response(null, { status: 412, headers: { ...NO_STORE, ...(version ? { ETag: version } : {}) } });
      }
      return new Response(null, { headers: { ...NO_STORE, ETag: versionOf(bytes) } });
    });
  }
  const file = Bun.file(path);
  if (!(await file.exists())) return new Response(null, { status: 404, headers: NO_STORE });
  const bytes = await file.bytes();
  const version = versionOf(bytes);
  const headers = { ...NO_STORE, ETag: version };
  if (req.headers.get("If-None-Match") === version) return new Response(null, { status: 304, headers });
  return sendPacked(bytes, req, headers);
}

export function createHandler(
  allowed: Record<string, string>,
  pinsPath = join(import.meta.dir, "pins.json"),
  stateDir = join(import.meta.dir, "state"),
) {
  return async (req: Request): Promise<Response> => {
    const host = req.headers.get("host");
    if (host !== null && !OWN_HOST.test(host)) return status(403, "Unknown host.");
    const url = new URL(req.url);
    if (CLIENT_MODULES.has(url.pathname)) return serveFile(join(import.meta.dir, url.pathname), req, { "Cache-Control": "no-cache", ...NO_SNIFF });
    if (FONTS.has(url.pathname)) {
      return new Response(Bun.file(join(import.meta.dir, url.pathname)), { headers: { "Cache-Control": "public, max-age=31536000, immutable", ...NO_SNIFF } });
    }
    if (url.pathname === "/favicon.ico") return status(404, "Not found.");
    // Every other path is a folder or note the page routes itself, so opening its URL directly must work.
    if (!url.pathname.startsWith("/api/")) return serveFile(INDEX, req, PAGE_HEADERS);
    if (url.pathname === "/api/roots") {
      return Response.json(Object.entries(allowed).map(([name, dir]) => describeRoot(name, dir)), { headers: NO_STORE });
    }

    if (url.pathname === "/api/pins" || url.pathname === "/api/state" || url.pathname === "/api/changed") {
      try {
        if (url.pathname === "/api/pins") return await handlePins(req, url, pinsPath, allowed);
        if (url.pathname === "/api/changed") return await handleChanged(req, url, stateDir, allowed);
        return await handleState(req, url, stateDir, allowed);
      } catch (error) {
        if (error instanceof UnreadableUpload) return status(400, "The upload could not be read.");
        console.error(error);
        return status(500, "Could not reach the saved state.");
      }
    }

    const isList = url.pathname === "/api/list";
    const isCreate = url.pathname === "/api/create";
    const isRename = url.pathname === "/api/rename";
    const isRaw = url.pathname === "/api/raw";
    if (!isList && !isCreate && !isRename && !isRaw && url.pathname !== "/api/file") return status(404, "Not found.");
    // PUT, not POST: browsers must ask before sending it cross-site, and this server never agrees.
    if ((isCreate || isRename) && req.method !== "PUT") return status(405, "Method not allowed.");
    if (isRaw && req.method !== "GET") return status(405, "Method not allowed.");

    const rootName = url.searchParams.get("root") ?? "";
    const rootDir = Object.hasOwn(allowed, rootName) ? allowed[rootName] : undefined;
    if (!rootDir) return status(404, "Unknown root.");

    try {
      const target = await locate(rootDir, url.searchParams.get("path") ?? "");
      if (!target) return status(403, "Outside the allowed folder.");
      if (isList) {
        const parts = (url.searchParams.get("path") ?? "").split("/").filter(Boolean);
        return await list(target, (name) => notePath(rootName, [...parts, name]), stateDir, req);
      }
      if (isCreate) return await createFile(target, url.searchParams.get("name") ?? "");
      if (isRaw) return await openRaw(target, req);
      if (!/\.md$/i.test(target)) return status(403, "Only markdown files can be edited.");
      if (isRename) return await renameFile(rootName, rootDir, target, url.searchParams.get("name") ?? "", pinsPath, stateDir);
      if (req.method === "GET") return await openFile(target, req);
      if (req.method === "PUT") return await saveFile(target, req);
      return status(405, "Method not allowed.");
    } catch (error) {
      if (error instanceof UnreadableUpload) return status(400, "The upload could not be read.");
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR") return status(404, "File not found.");
      if (code === "ENAMETOOLONG") return status(400, "Choose a shorter name.");
      console.error(error);
      return status(500, "Could not reach the file.");
    }
  };
}

if (import.meta.main) {
  const roots = await Bun.file(join(import.meta.dir, "roots.json")).json();
  const server = Bun.serve({ hostname: "127.0.0.1", port: PORT, development: false, fetch: createHandler(roots) });
  console.log(`md-phone listening on ${server.url}`);
}
