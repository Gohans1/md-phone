import { readdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const PORT = 4380;
const INDEX = join(import.meta.dir, "index.html");
const CLIENT_MODULES = new Set(["/changes.js", "/headings.js", "/history.js", "/marks.js", "/vendor/diff.js"]);
const HIDDEN_DIRS = new Set(["node_modules"]);
// Windows refuses to replace a file another program has open for a moment.
const BUSY_CODES = new Set(["EBUSY", "EPERM", "EACCES"]);
// Characters Windows forbids in a file name, plus its reserved device names.
const BAD_NAME = /[<>:"/\\|?*\p{Cc}]|^\.|^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/iu;

const NO_STORE = { "Cache-Control": "no-store" };
const utf8 = new TextDecoder("utf-8", { fatal: true });

const versionOf = (bytes: Uint8Array) => `"${Bun.hash(bytes).toString(36)}"`;
const status = (code: number, message: string) => new Response(message, { status: code });

async function locate(rootDir: string, path: string): Promise<string | null> {
  // A colon selects an NTFS alternate data stream or another drive.
  if (path.includes(":")) return null;
  const base = await realpath(rootDir);
  const target = await realpath(resolve(base, path));
  const inside = relative(base, target);
  const escaped = inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside);
  return escaped ? null : target;
}

async function replaceFile(path: string, bytes: Uint8Array) {
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temp, bytes);
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temp, path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!BUSY_CODES.has(code)) {
        await unlink(temp).catch(() => {});
        throw error;
      }
      if (attempt === 4) {
        // shortcut: a program in WSL holding the file open blocks replacing it from Windows for as long as it runs,
        // so this writes in place: not atomic, but the phone keeps its draft until the save succeeds.
        await writeFile(path, bytes);
        await unlink(temp).catch(() => {});
        return;
      }
      await Bun.sleep(100);
    }
  }
}

async function list(dir: string) {
  const entries = await readdir(dir, { withFileTypes: true });
  const names = (wanted: (entry: (typeof entries)[number]) => boolean) =>
    entries
      .filter(wanted)
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  return Response.json(
    {
      dirs: names((e) => e.isDirectory() && !e.name.startsWith(".") && !HIDDEN_DIRS.has(e.name)),
      files: names((e) => e.isFile() && /\.md$/i.test(e.name)),
    },
    { headers: NO_STORE },
  );
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
  return new Response(bytes, { headers: { ...headers, "Content-Type": "text/markdown; charset=utf-8" } });
}

// shortcut: another program could write between this check and the rename (a few ms),
// closing that gap needs OS file locks the other writers do not take anyway.
async function saveFile(path: string, req: Request) {
  const expected = req.headers.get("If-Match");
  if (!expected) return status(428, "If-Match is required.");
  const current = versionOf(await Bun.file(path).bytes());
  if (current !== expected) return new Response(null, { status: 412, headers: { ...NO_STORE, ETag: current } });
  const bytes = new Uint8Array(await req.arrayBuffer());
  await replaceFile(path, bytes);
  return new Response(null, { headers: { ...NO_STORE, ETag: versionOf(bytes) } });
}

async function createFile(dir: string, rawName: string) {
  const trimmed = rawName.trim();
  const name = /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
  if (!trimmed || BAD_NAME.test(name)) {
    return status(400, 'Choose another name. Names can’t start with a dot or use < > : " / \\ | ? *');
  }
  try {
    await writeFile(join(dir, name), "", { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return status(409, "That name is already used here. Choose another.");
    throw error;
  }
  return Response.json({ name }, { status: 201, headers: NO_STORE });
}

function describeRoot(name: string, dir: string) {
  const wsl = /^\\\\wsl(?:\.localhost|\$)\\[^\\]+(\\.*)?$/i.exec(dir);
  if (wsl) return { name, system: "WSL", path: (wsl[1] ?? "\\").replaceAll("\\", "/") };
  return { name, system: dir.startsWith("/") ? "Linux" : "Windows", path: dir };
}

export function createHandler(allowed: Record<string, string>) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (CLIENT_MODULES.has(url.pathname)) {
      return new Response(Bun.file(join(import.meta.dir, url.pathname)), { headers: { "Cache-Control": "no-cache" } });
    }
    // Every other path is a folder or note the page routes itself, so opening its URL directly must work.
    if (!url.pathname.startsWith("/api/")) return new Response(Bun.file(INDEX), { headers: { "Cache-Control": "no-cache" } });
    if (url.pathname === "/api/roots") {
      return Response.json(Object.entries(allowed).map(([name, dir]) => describeRoot(name, dir)), { headers: NO_STORE });
    }

    const isList = url.pathname === "/api/list";
    const isCreate = url.pathname === "/api/create";
    if (!isList && !isCreate && url.pathname !== "/api/file") return status(404, "Not found.");
    // PUT, not POST: browsers must ask before sending it cross-site, and this server never agrees.
    if (isCreate && req.method !== "PUT") return status(405, "Method not allowed.");

    const rootName = url.searchParams.get("root") ?? "";
    const rootDir = Object.hasOwn(allowed, rootName) ? allowed[rootName] : undefined;
    if (!rootDir) return status(404, "Unknown root.");

    try {
      const target = await locate(rootDir, url.searchParams.get("path") ?? "");
      if (!target) return status(403, "Outside the allowed folder.");
      if (isList) return await list(target);
      if (isCreate) return await createFile(target, url.searchParams.get("name") ?? "");
      if (!/\.md$/i.test(target)) return status(403, "Only markdown files can be edited.");
      if (req.method === "GET") return await openFile(target, req);
      if (req.method === "PUT") return await saveFile(target, req);
      return status(405, "Method not allowed.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return status(404, "File not found.");
      console.error(error);
      return status(500, "Could not reach the file.");
    }
  };
}

if (import.meta.main) {
  const roots = await Bun.file(join(import.meta.dir, "roots.json")).json();
  const server = Bun.serve({ hostname: "127.0.0.1", port: PORT, fetch: createHandler(roots) });
  console.log(`md-phone listening on ${server.url}`);
}
