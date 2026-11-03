import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandler } from "./server";

let base: string;
let root: string;
let handle: (req: Request) => Promise<Response>;

const fileUrl = (path: string) =>
  `http://x/api/file?root=docs&path=${encodeURIComponent(path)}`;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "md-phone-"));
  root = join(base, "docs");
  await mkdir(root);
  handle = createHandler({ docs: root });
});

afterEach(() => rm(base, { recursive: true, force: true }));

describe("saving a file", () => {
  it("writes the new text when the file has not changed since it was opened", async () => {
    await writeFile(join(root, "a.md"), "old");
    const opened = await handle(new Request(fileUrl("a.md")));

    const saved = await handle(
      new Request(fileUrl("a.md"), {
        method: "PUT",
        headers: { "If-Match": opened.headers.get("ETag")! },
        body: "new",
      }),
    );

    expect(saved.status).toBe(200);
    expect(saved.headers.get("ETag")).not.toBe(opened.headers.get("ETag"));
    expect(await readFile(join(root, "a.md"), "utf8")).toBe("new");
  });

  it("refuses the save and keeps the other writer's text when the file changed meanwhile", async () => {
    await writeFile(join(root, "a.md"), "old");
    const opened = await handle(new Request(fileUrl("a.md")));
    await writeFile(join(root, "a.md"), "written by the AI");

    const saved = await handle(
      new Request(fileUrl("a.md"), {
        method: "PUT",
        headers: { "If-Match": opened.headers.get("ETag")! },
        body: "from the phone",
      }),
    );

    expect(saved.status).toBe(412);
    expect(await readFile(join(root, "a.md"), "utf8")).toBe("written by the AI");
  });

  it("refuses a save that does not say which version it is based on", async () => {
    await writeFile(join(root, "a.md"), "old");

    const saved = await handle(new Request(fileUrl("a.md"), { method: "PUT", body: "new" }));

    expect(saved.status).toBe(428);
    expect(await readFile(join(root, "a.md"), "utf8")).toBe("old");
  });

  it("leaves no temporary files behind", async () => {
    await writeFile(join(root, "a.md"), "old");
    const opened = await handle(new Request(fileUrl("a.md")));

    await handle(
      new Request(fileUrl("a.md"), {
        method: "PUT",
        headers: { "If-Match": opened.headers.get("ETag")! },
        body: "new",
      }),
    );

    expect(await readdir(root)).toEqual(["a.md"]);
  });
});

describe("saving a file while something else writes it", () => {
  it("refuses a slow upload when the AI wrote the file before the upload finished", async () => {
    await writeFile(join(root, "a.md"), "old");
    const opened = await handle(new Request(fileUrl("a.md")));
    let finish!: () => void;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("from the "));
        finish = () => {
          controller.enqueue(new TextEncoder().encode("phone"));
          controller.close();
        };
      },
    });

    const saving = handle(
      new Request(fileUrl("a.md"), {
        method: "PUT",
        headers: { "If-Match": opened.headers.get("ETag")! },
        body,
        duplex: "half",
      } as RequestInit),
    );
    await Bun.sleep(20);
    await writeFile(join(root, "a.md"), "written by the AI");
    finish();
    const saved = await saving;

    expect(saved.status).toBe(412);
    expect(await readFile(join(root, "a.md"), "utf8")).toBe("written by the AI");
    expect(await readdir(root)).toEqual(["a.md"]);
  });

  it("accepts only one of two devices saving from the same version at once", async () => {
    for (let round = 0; round < 25; round++) {
      await writeFile(join(root, "a.md"), `round ${round}`);
      const opened = await handle(new Request(fileUrl("a.md")));
      const put = (body: string) =>
        handle(new Request(fileUrl("a.md"), { method: "PUT", headers: { "If-Match": opened.headers.get("ETag")! }, body }));

      const answers = await Promise.all([put("phone"), put("pc")]);

      expect(answers.map(({ status }) => status).sort()).toEqual([200, 412]);
      const winner = answers[0]!.status === 200 ? "phone" : "pc";
      expect(await readFile(join(root, "a.md"), "utf8")).toBe(winner);
    }
  });

  it("answers 404 and leaves nothing behind when the file was deleted before the save", async () => {
    await writeFile(join(root, "a.md"), "old");
    const opened = await handle(new Request(fileUrl("a.md")));
    await rm(join(root, "a.md"));

    const saved = await handle(
      new Request(fileUrl("a.md"), { method: "PUT", headers: { "If-Match": opened.headers.get("ETag")! }, body: "new" }),
    );

    expect(saved.status).toBe(404);
    expect(await readdir(root)).toEqual([]);
  });
});

describe("opening a file", () => {
  it("returns the exact bytes, including a BOM and Windows line endings", async () => {
    const bytes = Buffer.from("\uFEFFline one\r\nline two\r\n");
    await writeFile(join(root, "a.md"), bytes);

    const opened = await handle(new Request(fileUrl("a.md")));

    expect(Buffer.from(await opened.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("answers 304 when the file still matches the version the phone has", async () => {
    await writeFile(join(root, "a.md"), "same");
    const opened = await handle(new Request(fileUrl("a.md")));

    const checked = await handle(
      new Request(fileUrl("a.md"), {
        headers: { "If-None-Match": opened.headers.get("ETag")! },
      }),
    );

    expect(checked.status).toBe(304);
  });

  it("refuses to open a file that is not UTF-8, so saving cannot corrupt it", async () => {
    await writeFile(join(root, "a.md"), Buffer.from([0x63, 0x61, 0x66, 0xe9]));

    const opened = await handle(new Request(fileUrl("a.md")));

    expect(opened.status).toBe(415);
  });

  it("answers 404 for a missing file", async () => {
    const opened = await handle(new Request(fileUrl("missing.md")));

    expect(opened.status).toBe(404);
  });
});

describe("staying inside the allowed folders", () => {
  it("refuses a path that climbs out of the root", async () => {
    await writeFile(join(base, "secret.md"), "secret");

    const opened = await handle(new Request(fileUrl("../secret.md")));

    expect(opened.status).toBe(403);
  });

  it("refuses a path that names another computer, which Windows would contact and send its login to", async () => {
    for (const path of ["//evil/share/a.md", "\\\\evil\\share\\a.md", "/etc/a.md"]) {
      expect((await handle(new Request(fileUrl(path)))).status).toBe(403);
    }
  });

  it("refuses a link that points out of the root", async () => {
    await mkdir(join(base, "outside"));
    await writeFile(join(base, "outside", "secret.md"), "secret");
    await symlink(join(base, "outside"), join(root, "link"), "junction");

    const opened = await handle(new Request(fileUrl("link/secret.md")));

    expect(opened.status).toBe(403);
  });

  it("refuses files that are not markdown", async () => {
    await writeFile(join(root, "a.txt"), "text");

    const opened = await handle(new Request(fileUrl("a.txt")));

    expect(opened.status).toBe(403);
  });

  it("refuses a path with a colon, which on Windows names a hidden stream of a file", async () => {
    await writeFile(join(root, "a.md"), "text");

    const opened = await handle(new Request(fileUrl("a.md:hidden.md")));

    expect(opened.status).toBe(403);
  });

  it("answers 404 for a root that is not configured", async () => {
    const opened = await handle(new Request("http://x/api/file?root=toString&path=a.md"));

    expect(opened.status).toBe(404);
  });
});

describe("creating a file", () => {
  const createUrl = (folder: string, name: string) =>
    `http://x/api/create?root=docs&path=${encodeURIComponent(folder)}&name=${encodeURIComponent(name)}`;

  it("asks for a shorter name when the name is too long for the disk", async () => {
    const created = await handle(new Request(createUrl("", "a".repeat(300)), { method: "PUT" }));

    expect(created.status).toBe(400);
  });

  it("creates an empty file and adds .md when the name has no extension", async () => {
    const created = await handle(new Request(createUrl("", "Ghi chú"), { method: "PUT" }));

    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ name: "Ghi chú.md" });
    expect(await readFile(join(root, "Ghi chú.md"), "utf8")).toBe("");
  });

  it("creates the file inside the given subfolder", async () => {
    await mkdir(join(root, "notes"));

    await handle(new Request(createUrl("notes", "a.md"), { method: "PUT" }));

    expect(await readFile(join(root, "notes", "a.md"), "utf8")).toBe("");
  });

  it("refuses Windows console names, which are devices and not files", async () => {
    for (const name of ["CONIN$", "conout$.md", "con .md", "nul .md", "COM¹", "lpt³.md", "CLOCK$"]) {
      expect((await handle(new Request(createUrl("", name), { method: "PUT" }))).status).toBe(400);
    }
  });

  it("refuses a name with hidden direction marks, which would show a different name than it has", async () => {
    expect((await handle(new Request(createUrl("", "a\u202Etxt.md"), { method: "PUT" }))).status).toBe(400);
  });

  it("refuses to replace a file that already exists", async () => {
    await writeFile(join(root, "a.md"), "keep me");

    const created = await handle(new Request(createUrl("", "a.md"), { method: "PUT" }));

    expect(created.status).toBe(409);
    expect(await readFile(join(root, "a.md"), "utf8")).toBe("keep me");
  });

  it.each(["", "   ", "../escape", "a/b", "a\\b", "a:b", "CON", "nul.md", ".md", ".hidden"])(
    "refuses the name %p",
    async (name) => {
      const created = await handle(new Request(createUrl("", name), { method: "PUT" }));

      expect(created.status).toBe(400);
      expect(await readdir(base)).toEqual(["docs"]);
      expect(await readdir(root)).toEqual([]);
    },
  );

  it("refuses to create in a folder outside the root", async () => {
    const created = await handle(new Request(createUrl("..", "a.md"), { method: "PUT" }));

    expect(created.status).toBe(403);
    expect(await readdir(base)).toEqual(["docs"]);
  });

  it("only accepts PUT, which browsers will not send cross-site without permission", async () => {
    const created = await handle(new Request(createUrl("", "a.md"), { method: "POST" }));

    expect(created.status).toBe(405);
    expect(await readdir(root)).toEqual([]);
  });
});

describe("answering only for this machine's own names", () => {
  const withHost = (host: string) => new Request("http://x/api/roots", { headers: { host } });

  it("refuses a request for another host name, which a web page could point at this server", async () => {
    expect((await handle(withHost("attacker.example"))).status).toBe(403);
    expect((await handle(withHost("attacker.example:4380"))).status).toBe(403);
  });

  it("answers on this machine and through the tailnet", async () => {
    for (const host of ["127.0.0.1:4380", "localhost:4380", "my-pc.tail1234.ts.net", "my-pc.tail1234.ts.net:8444"]) {
      expect((await handle(withHost(host))).status).toBe(200);
    }
  });
});

describe("protecting the page", () => {
  it("can't be shown inside another site's frame, and its files are never second-guessed", async () => {
    const page = await handle(new Request("http://x/"));

    expect(page.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(page.headers.get("X-Frame-Options")).toBe("DENY");
    expect(page.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect((await handle(new Request("http://x/changes.js"))).headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("sending less over a slow connection", () => {
  it("accepts a gzip-compressed save and stores the plain text", async () => {
    await writeFile(join(root, "a.md"), "old");
    const opened = await handle(new Request(fileUrl("a.md")));
    const text = "nội dung mới ".repeat(500);

    const saved = await handle(
      new Request(fileUrl("a.md"), {
        method: "PUT",
        headers: { "If-Match": opened.headers.get("ETag")!, "Content-Encoding": "gzip" },
        body: Bun.gzipSync(new TextEncoder().encode(text)),
      }),
    );

    expect(saved.status).toBe(200);
    expect(await readFile(join(root, "a.md"), "utf8")).toBe(text);
    expect(saved.headers.get("ETag")).toBe((await handle(new Request(fileUrl("a.md")))).headers.get("ETag"));
  });

  it("refuses an upload that says it is compressed but isn't", async () => {
    await writeFile(join(root, "a.md"), "old");
    const opened = await handle(new Request(fileUrl("a.md")));

    const saved = await handle(
      new Request(fileUrl("a.md"), { method: "PUT", headers: { "If-Match": opened.headers.get("ETag")!, "Content-Encoding": "gzip" }, body: "plain" }),
    );

    expect(saved.status).toBe(400);
    expect(await readFile(join(root, "a.md"), "utf8")).toBe("old");
  });

  it("answers 304 for the page and its modules when they haven't changed", async () => {
    for (const path of ["/", "/changes.js"]) {
      const first = await handle(new Request(`http://x${path}`));
      const again = await handle(new Request(`http://x${path}`, { headers: { "If-None-Match": first.headers.get("ETag")! } }));

      expect(again.status).toBe(304);
    }
  });

  it("sends the page compressed to a browser that accepts gzip", async () => {
    const plain = await (await handle(new Request("http://x/"))).text();
    const packed = await handle(new Request("http://x/", { headers: { "Accept-Encoding": "gzip, br" } }));

    expect(packed.headers.get("Content-Encoding")).toBe("gzip");
    expect(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await packed.arrayBuffer())))).toBe(plain);
  });

  it("sends a big note compressed, with the same version tag a save checks against", async () => {
    const text = "dòng ghi chú\n".repeat(2000);
    await writeFile(join(root, "a.md"), text);
    const plain = await handle(new Request(fileUrl("a.md")));

    const packed = await handle(new Request(fileUrl("a.md"), { headers: { "Accept-Encoding": "gzip" } }));

    expect(packed.headers.get("Content-Encoding")).toBe("gzip");
    expect(packed.headers.get("ETag")).toBe(plain.headers.get("ETag"));
    expect(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await packed.arrayBuffer())))).toBe(text);
  });

  it("answers 404 for the browser's icon request instead of sending the whole page", async () => {
    expect((await handle(new Request("http://x/favicon.ico"))).status).toBe(404);
  });

  it("answers 304 for a folder listing that hasn't changed", async () => {
    await writeFile(join(root, "a.md"), "text");
    const listUrl = "http://x/api/list?root=docs&path=";
    const first = await handle(new Request(listUrl));

    const again = await handle(new Request(listUrl, { headers: { "If-None-Match": first.headers.get("ETag")! } }));

    expect(again.status).toBe(304);
  });
});

describe("opening a URL directly", () => {
  it("serves the page for a note's path, without reading the note itself", async () => {
    await writeFile(join(root, "a.md"), "private text");

    const page = await handle(new Request("http://x/docs/a.md"));

    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toStartWith("<!doctype html>");
    expect(html).not.toContain("private text");
  });

  it("still answers 404 for an unknown API path", async () => {
    const answer = await handle(new Request("http://x/api/nope"));

    expect(answer.status).toBe(404);
  });
});

describe("pins shared between devices", () => {
  const pinUrl = (pin: string) => `http://x/api/pins?pin=${encodeURIComponent(pin)}`;
  const pinsOf = async (handler: typeof handle) =>
    (await handler(new Request("http://x/api/pins"))).json();
  let phone: typeof handle;
  let pc: typeof handle;

  beforeEach(() => {
    const file = join(base, "pins.json");
    phone = createHandler({ docs: root }, file);
    pc = createHandler({ docs: root }, file);
  });

  it("starts with no pins", async () => {
    expect(await pinsOf(pc)).toEqual([]);
  });

  it("shows a pin made on one device to another", async () => {
    await phone(new Request(pinUrl("/docs/a.md"), { method: "PUT" }));

    expect(await pinsOf(pc)).toEqual(["/docs/a.md"]);
  });

  it("removes only the pin that was unpinned", async () => {
    await phone(new Request(pinUrl("/docs/a.md"), { method: "PUT" }));
    await phone(new Request(pinUrl("/docs/b.md"), { method: "PUT" }));

    await pc(new Request(pinUrl("/docs/a.md"), { method: "DELETE" }));

    expect(await pinsOf(phone)).toEqual(["/docs/b.md"]);
  });

  it("keeps one copy when the same file is pinned twice", async () => {
    await phone(new Request(pinUrl("/docs/a.md"), { method: "PUT" }));
    await pc(new Request(pinUrl("/docs/a.md"), { method: "PUT" }));

    expect(await pinsOf(pc)).toEqual(["/docs/a.md"]);
  });

  it("keeps every pin when several arrive at once", async () => {
    const names = ["a", "b", "c", "d", "e"].map((name) => `/docs/${name}.md`);

    await Promise.all(names.map((pin) => phone(new Request(pinUrl(pin), { method: "PUT" }))));

    expect((await pinsOf(pc)).sort()).toEqual(names);
  });

  it.each(["//evil.example/a.md", "/other/a.md", "/docs/a.txt", "/docs/%E0%A4%A.md", "a.md", ""])(
    "refuses the pin %p",
    async (pin) => {
      const answer = await phone(new Request(pinUrl(pin), { method: "PUT" }));

      expect(answer.status).toBe(400);
      expect(await pinsOf(pc)).toEqual([]);
    },
  );

  it("refuses POST, which browsers can send cross-site without asking", async () => {
    const answer = await phone(new Request(pinUrl("/docs/a.md"), { method: "POST" }));

    expect(answer.status).toBe(405);
    expect(await pinsOf(pc)).toEqual([]);
  });
});

describe("note state shared between devices", () => {
  const stateUrl = (note: string, kind = "note") =>
    `http://x/api/state?kind=${kind}&note=${encodeURIComponent(note)}`;
  const create = (body: string) => ({ method: "PUT", headers: { "If-None-Match": "*" }, body });
  const update = (etag: string, body: string) => ({ method: "PUT", headers: { "If-Match": etag }, body });
  let phone: typeof handle;
  let pc: typeof handle;

  beforeEach(() => {
    const dir = join(base, "state");
    phone = createHandler({ docs: root }, join(base, "pins.json"), dir);
    pc = createHandler({ docs: root }, join(base, "pins.json"), dir);
  });

  const read = async (handler: typeof handle, note = "/docs/a.md") => (await handler(new Request(stateUrl(note)))).text();

  it("sends a big state compressed", async () => {
    const body = JSON.stringify({ marks: [], reviewed: "chữ ".repeat(5000) });
    await phone(new Request(stateUrl("/docs/a.md"), create(body)));

    const packed = await pc(new Request(stateUrl("/docs/a.md"), { headers: { "Accept-Encoding": "gzip" } }));

    expect(packed.headers.get("Content-Encoding")).toBe("gzip");
    expect(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await packed.arrayBuffer())))).toBe(body);
  });

  it("answers 404 for a note with no state yet", async () => {
    expect((await pc(new Request(stateUrl("/docs/a.md")))).status).toBe(404);
  });

  it("gives another device exactly what one device saved", async () => {
    await phone(new Request(stateUrl("/docs/a.md"), create('{"marks":[1]}')));

    expect(await read(pc)).toBe('{"marks":[1]}');
  });

  it("keeps each note and each kind apart", async () => {
    await phone(new Request(stateUrl("/docs/a.md"), create("a")));
    await phone(new Request(stateUrl("/docs/b.md"), create("b")));
    await phone(new Request(stateUrl("/docs/a.md", "scroll"), { method: "PUT", body: "s" }));

    expect(await read(pc)).toBe("a");
    expect(await read(pc, "/docs/b.md")).toBe("b");
    expect(await (await pc(new Request(stateUrl("/docs/a.md", "scroll")))).text()).toBe("s");
  });

  it("answers 304 when nothing changed since the version a device has, and sends new state when it did", async () => {
    const saved = await phone(new Request(stateUrl("/docs/a.md"), create("one")));
    const version = saved.headers.get("ETag")!;
    const ask = () => pc(new Request(stateUrl("/docs/a.md"), { headers: { "If-None-Match": version } }));

    expect((await ask()).status).toBe(304);

    await pc(new Request(stateUrl("/docs/a.md"), update(version, "two")));

    expect(await (await ask()).text()).toBe("two");
  });

  it("refuses to overwrite state a device has not seen, and says which version is current", async () => {
    const saved = await phone(new Request(stateUrl("/docs/a.md"), create("one")));
    const seen = saved.headers.get("ETag")!;
    const newer = await pc(new Request(stateUrl("/docs/a.md"), update(seen, "two")));

    const stale = await phone(new Request(stateUrl("/docs/a.md"), update(seen, "stale")));

    expect(stale.status).toBe(412);
    expect(stale.headers.get("ETag")).toBe(newer.headers.get("ETag"));
    expect(await read(pc)).toBe("two");
  });

  it("refuses to create state another device already created", async () => {
    await phone(new Request(stateUrl("/docs/a.md"), create("one")));

    const second = await pc(new Request(stateUrl("/docs/a.md"), create("two")));

    expect(second.status).toBe(412);
    expect(await read(pc)).toBe("one");
  });

  it("refuses an update of state that no longer exists", async () => {
    const stale = await phone(new Request(stateUrl("/docs/a.md"), update('"gone"', "stale")));

    expect(stale.status).toBe(412);
    expect((await pc(new Request(stateUrl("/docs/a.md")))).status).toBe(404);
  });

  it("refuses a write of note state that does not say which version it is based on", async () => {
    const answer = await phone(new Request(stateUrl("/docs/a.md"), { method: "PUT", body: "x" }));

    expect(answer.status).toBe(428);
    expect((await pc(new Request(stateUrl("/docs/a.md")))).status).toBe(404);
  });

  it("accepts only one of several writes from the same version", async () => {
    const saved = await phone(new Request(stateUrl("/docs/a.md"), create("base")));
    const seen = saved.headers.get("ETag")!;

    const answers = await Promise.all(
      ["a", "b", "c", "d"].map((body) => phone(new Request(stateUrl("/docs/a.md"), update(seen, body)))),
    );

    expect(answers.filter(({ status }) => status === 200)).toHaveLength(1);
  });

  it.each([
    ["/other/a.md", "note"],
    ["/docs/a.txt", "note"],
    ["../../secret.md", "note"],
    ["/docs/a.md", "other"],
    ["/docs/a.md", "toString"],
  ])("refuses note %p with kind %p", async (note, kind) => {
    const answer = await phone(new Request(stateUrl(note, kind), create("x")));

    expect(answer.status).toBe(400);
    expect(await readdir(base)).toEqual(["docs"]);
  });

  it("refuses POST, which browsers can send cross-site without asking", async () => {
    const answer = await phone(new Request(stateUrl("/docs/a.md"), { method: "POST", body: "x" }));

    expect(answer.status).toBe(405);
  });
});

describe("listing a folder", () => {
  it("shows folders and markdown files, hiding everything else", async () => {
    await writeFile(join(root, "b.md"), "");
    await writeFile(join(root, "a.MD"), "");
    await writeFile(join(root, "c.txt"), "");
    await mkdir(join(root, "notes"));
    await mkdir(join(root, ".git"));
    await mkdir(join(root, "node_modules"));

    const listed = await handle(new Request("http://x/api/list?root=docs&path="));

    expect(await listed.json()).toEqual({ dirs: ["notes"], files: ["a.MD", "b.md"], changed: [] });
  });

  it("names the roots without touching their folders", async () => {
    const roots = createHandler({ gone: join(base, "does-not-exist") });

    const listed = await roots(new Request("http://x/api/roots"));

    expect((await listed.json()).map((root: { name: string }) => root.name)).toEqual(["gone"]);
  });

  it("says which system each root is on, with the path as that system writes it", async () => {
    const roots = createHandler({
      win: "C:\\Users\\me\\notes",
      wsl: "\\\\wsl.localhost\\Ubuntu\\home\\me\\notes",
      old: "\\\\wsl$\\Debian\\home\\me",
      nas: "\\\\server\\share\\notes",
      linux: "/srv/notes",
    });

    const listed = await roots(new Request("http://x/api/roots"));

    expect(await listed.json()).toEqual([
      { name: "win", system: "Windows", path: "C:\\Users\\me\\notes" },
      { name: "wsl", system: "WSL", path: "/home/me/notes" },
      { name: "old", system: "WSL", path: "/home/me" },
      { name: "nas", system: "Windows", path: "\\\\server\\share\\notes" },
      { name: "linux", system: "Linux", path: "/srv/notes" },
    ]);
  });
});

describe("telling which notes someone else changed", () => {
  const stateDir = () => join(base, "state");
  let app: typeof handle;

  beforeEach(() => {
    app = createHandler({ docs: root }, join(base, "pins.json"), stateDir());
  });

  const review = async (note: string, reviewed: string | null) => {
    const res = await app(
      new Request(`http://x/api/state?kind=note&note=${encodeURIComponent(note)}`, {
        method: "PUT",
        headers: { "If-None-Match": "*" },
        body: JSON.stringify({ marks: [], reviewed, history: { done: [], undone: [], hash: "" } }),
      }),
    );
    expect(res.status).toBe(200);
  };
  const listed = async (path = "") => (await app(new Request(`http://x/api/list?root=docs&path=${encodeURIComponent(path)}`))).json();
  const changed = async (...notes: string[]) =>
    app(new Request(`http://x/api/changed?${notes.map((note) => `note=${encodeURIComponent(note)}`).join("&")}`));

  it("lists a note whose text differs from the copy last reviewed", async () => {
    await writeFile(join(root, "a.md"), "the AI rewrote this");
    await writeFile(join(root, "b.md"), "untouched");
    await review("/docs/a.md", "what I read");
    await review("/docs/b.md", "untouched");

    expect((await listed()).changed).toEqual(["a.md"]);
  });

  it("leaves out notes nobody has opened yet", async () => {
    await writeFile(join(root, "a.md"), "text");

    expect((await listed()).changed).toEqual([]);
  });

  it("leaves out a note whose review has no copy yet", async () => {
    await writeFile(join(root, "a.md"), "text");
    await review("/docs/a.md", null);

    expect((await listed()).changed).toEqual([]);
  });

  it("compares a Windows file without its \\r, as the page reads it", async () => {
    await writeFile(join(root, "a.md"), "one\r\ntwo");
    await review("/docs/a.md", "one\ntwo");

    expect((await listed()).changed).toEqual([]);
  });

  it("keeps a byte order mark, as the page reads it", async () => {
    await writeFile(join(root, "a.md"), "\uFEFF# Notes");
    await review("/docs/a.md", "\uFEFF# Notes");

    expect((await listed()).changed).toEqual([]);
  });

  it("finds notes in a subfolder, whose names need encoding", async () => {
    await mkdir(join(root, "my notes"));
    await writeFile(join(root, "my notes", "kịch bản.md"), "new");
    await review("/docs/my%20notes/k%E1%BB%8Bch%20b%E1%BA%A3n.md", "old");

    expect((await listed("my notes")).changed).toEqual(["kịch bản.md"]);
  });

  it("answers for a list of notes, such as the pinned ones", async () => {
    await writeFile(join(root, "a.md"), "new");
    await writeFile(join(root, "b.md"), "same");
    await review("/docs/a.md", "old");
    await review("/docs/b.md", "same");

    const res = await changed("/docs/a.md", "/docs/b.md", "/docs/missing.md");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(["/docs/a.md"]);
  });

  it("never compares a file outside the root, even through a path that climbs out", async () => {
    await writeFile(join(base, "secret.md"), "guess");
    await review("/docs/../secret.md", "wrong guess");
    await review("/docs/%2E%2E/secret.md", "wrong guess");

    expect(await (await changed("/docs/../secret.md", "/docs/%2E%2E/secret.md")).json()).toEqual([]);
  });

  it("skips a note outside the allowed folders, so one stale pin doesn't hide the others", async () => {
    await writeFile(join(root, "a.md"), "new");
    await review("/docs/a.md", "old");

    const res = await changed("/elsewhere/a.md", "/docs/a.md");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(["/docs/a.md"]);
  });

  it("drops the dot once the note is reviewed again", async () => {
    await writeFile(join(root, "a.md"), "the AI's text");
    await review("/docs/a.md", "old");
    expect((await listed()).changed).toEqual(["a.md"]);
    const url = `http://x/api/state?kind=note&note=${encodeURIComponent("/docs/a.md")}`;
    const tag = (await app(new Request(url))).headers.get("ETag")!;

    await app(
      new Request(url, {
        method: "PUT",
        headers: { "If-Match": tag },
        body: JSON.stringify({ marks: [], reviewed: "the AI's text", history: { done: [], undone: [], hash: "" } }),
      }),
    );

    expect((await listed()).changed).toEqual([]);
  });

  it("skips a pin whose name is not valid percent-encoding", async () => {
    await writeFile(join(root, "a.md"), "new");
    await review("/docs/a.md", "old");

    const res = await changed("/docs/%E0%A4%A.md", "/docs/a.md");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(["/docs/a.md"]);
  });

  it("notices the AI writing a note after the folder was last listed", async () => {
    await writeFile(join(root, "a.md"), "same");
    await review("/docs/a.md", "same");
    expect((await listed()).changed).toEqual([]);

    await writeFile(join(root, "a.md"), "the AI wrote more");

    expect((await listed()).changed).toEqual(["a.md"]);
  });

  it("treats unreadable saved state as no review", async () => {
    await writeFile(join(root, "a.md"), "text");
    await review("/docs/a.md", "old");
    for (const name of await readdir(stateDir())) await writeFile(join(stateDir(), name), "{broken");

    expect((await listed()).changed).toEqual([]);
  });
});
