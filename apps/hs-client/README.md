# hs-client — Orca thin client for macOS 10.13 High Sierra

Proof of concept. An Electron 26.6.10 shell (Chromium 116, the last Electron that runs on
10.13) that loads the web UI served by a Remote Orca Server. No local worktrees, terminals or
agents run on the client; everything runs on the server.

Status (2026-10-09): paired and rendered the full Orca UI on a MacBook9,1 / 10.13.6 against
Orca 1.4.223 serving on the LAN. See `app/main.js` for the shell and `app/preload.js` for the
ES2024 polyfills Chromium 116 needs.

## Build (on the modern Mac)

    ./build.sh            # produces dist/OrcaHS.zip

## Install / run (on the 10.13 machine)

Everything the app writes stays under `--base-dir`.

    mkdir -p ~/Desktop/OrcaHS && cd ~/Desktop/OrcaHS && unzip OrcaHS.zip
    open -na ~/Desktop/OrcaHS/OrcaHS.app --args --base-dir=$HOME/Desktop/OrcaHS/data

First launch shows a prompt page. Paste any of:

- `orca://pair?code=…` (Settings → Remote Orca Servers → Pair another Orca client)
- the browser URL printed by `orca serve` (`http://<server>:6768/#code=…`)
- the bare pairing code
- a server URL you already paired with (`http://<server>:6768/`)

All of them carry the same payload; `app/pair-link.js` turns them into the URL the web client
expects. The same inputs work for `--url=` on the command line and for `data/server-url.txt`.
After the server page loads, only the server origin is written back to `server-url.txt`
(mode 600); the pairing code lives in the page's localStorage, as in the upstream web client.

## Tests

    node --test test/pair-link.test.js

## Known gaps on Chromium 116

- `pdf.worker.min-*.mjs` runs in a Worker where the preload polyfills do not apply and it
  uses `Promise.withResolvers`; PDF preview is expected to fail.
- Plain `http://` is not a secure context, so Chromium removes `navigator.clipboard` and
  `crypto.subtle`. The shell installs a write-only clipboard shim: `writeText` is forwarded to
  the main process, which checks sender, main frame, exact server origin, size and rate
  (`app/clipboard-policy.js`). `readText`/`read`/`write` are rejected; paste with Cmd+V.
- Electron 26 is end of life; keep the client on a private network path only.
