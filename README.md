# md-phone

Edit the Markdown files on your Windows PC (and inside WSL) from your phone, over Tailscale.

A small [Bun](https://bun.com) server with no runtime dependencies and one HTML page. It autosaves as you type, and if an AI agent or another program changed the file on the PC, it refuses to overwrite that change and asks you which version to keep.

## Screenshots

### Phone

<table>
  <tr>
    <td><img src="docs/screenshots/mobile-home.png" alt="Home screen with allowed folders and a Pinned section showing each file's path" width="200"></td>
    <td><img src="docs/screenshots/mobile-folder.png" alt="Folder view with subfolders and files that can be pinned" width="200"></td>
    <td><img src="docs/screenshots/mobile-editor.png" alt="A note open in the editor with colored headings" width="200"></td>
    <td><img src="docs/screenshots/mobile-contents.png" alt="Contents sheet listing the note's headings, with top and bottom buttons" width="200"></td>
    <td><img src="docs/screenshots/mobile-conflict.png" alt="Warning that the file changed on the PC, offering to keep either version" width="200"></td>
  </tr>
  <tr>
    <td align="center">Home</td>
    <td align="center">Folder</td>
    <td align="center">Editor</td>
    <td align="center">Contents</td>
    <td align="center">Conflict</td>
  </tr>
</table>

### Desktop

<table>
  <tr>
    <td><img src="docs/screenshots/desktop-home.png" alt="Home screen on a desktop browser" width="400"></td>
    <td><img src="docs/screenshots/desktop-folder.png" alt="Folder view on a desktop browser" width="400"></td>
  </tr>
  <tr>
    <td align="center">Home</td>
    <td align="center">Folder</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/desktop-editor.png" alt="A note with colored headings on a desktop browser" width="400"></td>
    <td><img src="docs/screenshots/desktop-contents.png" alt="Contents sheet on a desktop browser" width="400"></td>
  </tr>
  <tr>
    <td align="center">Editor</td>
    <td align="center">Contents</td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="docs/screenshots/desktop-conflict.png" alt="Conflict warning on a desktop browser" width="400"></td>
  </tr>
  <tr>
    <td colspan="2" align="center">Conflict</td>
  </tr>
</table>

The notes in these screenshots are made up.

## Features

- Browse folders you allow, then open, edit or create `.md` files
- Autosave, with a draft kept on the phone if the connection drops
- Conflict detection through `ETag` and `If-Match`
- Keeps BOMs and Windows line endings, and refuses files that are not UTF-8
- Pin files to the top of their folder and to a Pinned section on the home screen (pins are stored in that browser)
- Contents sheet built from the note's headings, with jumps to the top and bottom (opens by itself on notes with 5 or more headings)
- Colored headings that are display only, so nothing is added to the file
- Undo and redo buttons that also survive closing the tab, for when a whole block gets deleted by mistake
- Mark several spots in a note and jump back to any of them (marks follow their line as you edit, and are stored in that browser)
- Each note reopens where you left it, and every folder and note has its own URL

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
