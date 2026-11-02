# md-phone

Edit the Markdown files on your Windows PC (and inside WSL) from your phone, over Tailscale.

A small [Bun](https://bun.com) server with no runtime dependencies and one HTML page. It autosaves as you type, and if an AI agent or another program changed the file on the PC, it refuses to overwrite that change and asks you which version to keep.

## Features

- Browse folders you allow, then open, edit or create `.md` files
- Autosave, with a draft kept on the phone if the connection drops
- Conflict detection through `ETag` and `If-Match`
- Keeps BOMs and Windows line endings, and refuses files that are not UTF-8
- Pin files to the top of their folder and to a Pinned section on the home screen (pins are stored in that browser)

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
