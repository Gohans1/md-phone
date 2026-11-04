# md-phone

Edit the Markdown files on your Windows PC (and inside WSL) from your phone, over Tailscale.

A small [Bun](https://bun.com) server with no runtime dependencies and one HTML page. It autosaves as you type, and if an AI agent or another program changed the file on the PC, it refuses to overwrite that change and asks you which version to keep.

## Screenshots

### Phone

<table>
  <tr>
    <td><img src="docs/screenshots/mobile-home.png" alt="Home screen with folders grouped by Windows and WSL, and pinned files with their full paths" width="200"></td>
    <td><img src="docs/screenshots/mobile-folder.png" alt="Folder view with subfolders and files that can be pinned" width="200"></td>
    <td><img src="docs/screenshots/mobile-editor.png" alt="A note with colored headings, two marks in the text, and a Mark button floating at the cursor" width="200"></td>
    <td><img src="docs/screenshots/mobile-contents.png" alt="Contents sheet with bullet point and mark counts for each heading" width="200"></td>
  </tr>
  <tr>
    <td align="center">Home</td>
    <td align="center">Folder</td>
    <td align="center">Editor and marks</td>
    <td align="center">Contents</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/mobile-marks.png" alt="Marks list showing the text around each mark, its line and its heading" width="200"></td>
    <td><img src="docs/screenshots/mobile-changes.png" alt="Word-level diff of what changed since the last review, with Discard and Mark as reviewed buttons" width="200"></td>
    <td><img src="docs/screenshots/mobile-conflict.png" alt="Warning that the file changed on the PC, offering to keep either version" width="200"></td>
  </tr>
  <tr>
    <td align="center">Marks</td>
    <td align="center">Changes</td>
    <td align="center">Conflict</td>
  </tr>
</table>

### Desktop

<table>
  <tr>
    <td><img src="docs/screenshots/desktop-home.png" alt="Home screen with folders grouped by Windows and WSL, and pinned files with their full paths" width="400"></td>
    <td><img src="docs/screenshots/desktop-folder.png" alt="Folder view with subfolders and files that can be pinned" width="400"></td>
  </tr>
  <tr>
    <td align="center">Home</td>
    <td align="center">Folder</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/desktop-editor.png" alt="A note with colored headings, two marks in the text, and a Mark button floating at the cursor" width="400"></td>
    <td><img src="docs/screenshots/desktop-contents.png" alt="Contents sheet with bullet point and mark counts for each heading" width="400"></td>
  </tr>
  <tr>
    <td align="center">Editor and marks</td>
    <td align="center">Contents</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/desktop-marks.png" alt="Marks list showing the text around each mark, its line and its heading" width="400"></td>
    <td><img src="docs/screenshots/desktop-changes.png" alt="Word-level diff of what changed since the last review, with Discard and Mark as reviewed buttons" width="400"></td>
  </tr>
  <tr>
    <td align="center">Marks</td>
    <td align="center">Changes</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/desktop-conflict.png" alt="Warning that the file changed on the PC, offering to keep either version" width="400"></td>
  </tr>
  <tr>
    <td align="center">Conflict</td>
  </tr>
</table>

The notes and folder paths in these screenshots are made up.

## Features

- Browse folders you allow, grouped by Windows and WSL with their full paths, then open, edit or create `.md` files
- Autosave, with a draft kept on the phone if the connection drops
- Conflict detection through `ETag` and `If-Match`
- Keeps BOMs and Windows line endings, and refuses files that are not UTF-8
- Pin files and folders to the top of their folder and to a Pinned section on the home screen
- An eye button in each folder also lists files that aren't Markdown. They open read-only as plain text, up to 2 MB, and hidden files that start with a dot stay hidden
- New file from the home screen, into the folder named `desktop` in `roots.json` unless you pick another; it is pinned so it shows on the home screen
- Rename a note by tapping its name at the top of the editor. Its pin, marks, undo steps and reading position move with it, and a name already used in that folder is refused
- Pins, marks, undo steps, reviewed copies and reading position are shared by every device, stored in `pins.json` and `state/` next to the server. Devices merge what they changed instead of replacing each other's state. Unsaved drafts stay in the browser that typed them
- Contents sheet built from the note's headings, with jumps to the top and bottom, showing how many bullet points and marks each heading has
- Colored headings that are display only, so nothing is added to the file
- A green dot on notes that an AI or another program changed since you last read them, in folders and in Pinned
- Opening such a note shows what changed right in the text: new text highlighted, removed text struck out. Each change stays until it has been on screen long enough to read (2 seconds plus about 240 words a minute), then dims and leaves once you scroll past it, and counts as read. Changes made while the note was closed become one Undo step, so anything removed can be brought back (text typed on any of your devices isn't counted)
- A Changes screen with a GitHub-style word diff of everything not yet read, with one tap to accept or discard it. Tapping a change, or its "Go to line" button, opens the note at that change, at the same height on screen and still marked
- Undo and redo buttons that also survive closing the tab, for when a whole block gets deleted by mistake. Each step briefly shows what it added and removed, until the next tap, scroll or key press
- Find in the note with Ctrl+F or the search button. Typing without marks finds Vietnamese text, and matches are only painted on screen
- Mark the exact cursor position from a button that floats at the cursor, and jump back from a Marks list (marks follow their character as you edit)
- Each note reopens where you left it, and every folder and note has its own URL
- A Read button shows the note as formatted Markdown (headings, lists, tables, code, links) at the same place, and remembers the choice. Raw HTML in a note is shown as text, not run. A note with unread changes always opens in the editor first

## Setup

```powershell
git clone https://github.com/Gohans1/md-phone
cd md-phone
bun install
copy roots.example.json roots.json
```

Edit `roots.json` so each name points to a folder you want to edit. Then start the server:

```powershell
bun start
```

Expose it to your tailnet only:

```powershell
tailscale serve --bg --https=8444 http://127.0.0.1:4380
```

Open `https://<your-machine>.<your-tailnet>.ts.net:8444` on your phone.

To start it with Windows, put a shortcut to `start-hidden.vbs` in the `shell:startup` folder.

## Security

The server has no login. It listens on `127.0.0.1`, and Tailscale decides who can reach it, so anyone on your tailnet can edit every `.md` file under your `roots.json` folders. Never expose it with `tailscale funnel` or a public proxy, and allow only folders you are willing to edit from the phone.

## Tests

```bash
bun test
```

## License

[MIT](LICENSE)

`vendor/diff.js` is a minified build of [jsdiff](https://github.com/kpdecker/jsdiff), BSD-3-Clause, see `vendor/diff.LICENSE`. Rebuild it with `bun run vendor`.

`vendor/markdown-it.js` is a minified build of [markdown-it](https://github.com/markdown-it/markdown-it), MIT, with the packages it bundles (entities is BSD-2-Clause, the rest MIT), see `vendor/markdown-it.LICENSE`. `bun run vendor` rebuilds it too.

`vendor/fonts/` holds [Inter](https://github.com/rsms/inter) by The Inter Project Authors, SIL Open Font License 1.1, see `vendor/fonts/inter.LICENSE`.
