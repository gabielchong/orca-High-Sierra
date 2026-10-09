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

First launch shows a prompt page: paste the server's browser URL
(`http://<server>:6768/#code=<pairing code>`; the `code=` value is the same payload as in an
`orca://pair?code=` link). After a successful pairing the environment is kept in the page's
localStorage and the plain `http://<server>:6768/` URL reconnects; you can then delete
`data/server-url.txt` so the token is no longer on disk.

## Known gaps on Chromium 116

- `pdf.worker.min-*.mjs` runs in a Worker where the preload polyfills do not apply and it
  uses `Promise.withResolvers`; PDF preview is expected to fail.
- Plain `http://` is not a secure context: `crypto.subtle` and `navigator.clipboard` are
  unavailable, and the App chunk calls `navigator.clipboard.writeText` unguarded.
- Electron 26 is end of life; keep the client on a private network path only.
