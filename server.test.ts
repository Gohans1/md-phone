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

describe("listing a folder", () => {
  it("shows folders and markdown files, hiding everything else", async () => {
    await writeFile(join(root, "b.md"), "");
    await writeFile(join(root, "a.MD"), "");
    await writeFile(join(root, "c.txt"), "");
    await mkdir(join(root, "notes"));
    await mkdir(join(root, ".git"));
    await mkdir(join(root, "node_modules"));

    const listed = await handle(new Request("http://x/api/list?root=docs&path="));

    expect(await listed.json()).toEqual({ dirs: ["notes"], files: ["a.MD", "b.md"] });
  });

  it("names the roots without touching their folders", async () => {
    const roots = createHandler({ gone: join(base, "does-not-exist") });

    const listed = await roots(new Request("http://x/api/roots"));

    expect(await listed.json()).toEqual(["gone"]);
  });
});
