# OrcaHS — Orca for old Macs

Use [Orca](https://github.com/stablyai/orca), the AI orchestrator IDE, from a Mac that is too old to run it.

OrcaHS is a small desktop client for **macOS 10.13 High Sierra and later Intel Macs**. It does not run Orca itself. Instead it connects to a Remote Orca Server running on a modern machine and shows the full Orca interface: workspaces, terminals, agents, diffs. The old Mac only draws the UI and sends your input; everything else runs on the server.

> Status: working. Paired, browsed workspaces, ran remote terminals and typed CJK text on a 2016 MacBook (MacBook9,1) running 10.13.6 against Orca 1.4.223.

## Why this exists

Orca is built on Electron 43, Node 24 and Swift 6 tooling, none of which run on macOS before 12 or 13. Electron dropped High Sierra in version 27, Node dropped it in version 18. A straight port is not realistic.

Orca does, however, ship a browser client and a Remote Orca Server mode. OrcaHS wraps that browser client in the last Electron release that still runs on 10.13 (Electron 26, Chromium 116), adds the few polyfills Chromium 116 needs, and keeps the shell locked down: remote content runs sandboxed, may only navigate within the server you chose, and gets exactly one extra capability (writing to the clipboard), nothing else.

```
Old Mac (10.13+)                         Modern Mac / Linux / VPS
┌──────────────────────┐    LAN, VPN     ┌────────────────────────────┐
│ OrcaHS.app           │  or SSH tunnel  │ Orca desktop or orca serve │
│ Electron 26 shell    │ ◄─────────────► │ repos, worktrees, git      │
│ renders Orca web UI  │  ws / http      │ terminals, agents, browser │
└──────────────────────┘                 └────────────────────────────┘
```

## Requirements

**On the old Mac (client)**

- macOS 10.13 High Sierra or later, 64-bit Intel. Apple Silicon Macs can run the real Orca; use that instead.
- Nothing else. No Xcode, no Homebrew, no Node. The app is self-contained.

**On the server machine**

- Orca installed and running, either the desktop app or `orca serve`. Tested against Orca 1.4.223; newer servers should work but the UI they serve may one day need a browser feature Chromium 116 lacks (see [Limitations](#limitations)).
- The agents you want to use (Claude Code, Codex, OpenCode, …) installed and signed in **on the server**. Logins on the old Mac do not carry over.
- A network path between the two machines: same LAN, a VPN such as Tailscale on the server side, or an SSH tunnel. See [Using it away from home](#using-it-away-from-home).

## Quick start

### 1. Turn the modern machine into an Orca server

In the Orca desktop app: **Settings → Remote Orca Servers → Advertise this app as a server → New Link**. Pick the address the old Mac can reach (your LAN IP, or a Tailscale IP), click **Generate Access Link**, and copy the link under **Pair another Orca client**. It looks like `orca://pair?code=…`.

Headless alternative:

```bash
orca serve --port 6768 --pairing-address <reachable-ip>
```

This prints a pairing link and a browser URL. Either works in OrcaHS.

### 2. Install OrcaHS on the old Mac

Download `OrcaHS-<version>.dmg` from the Releases page, open it and drag **OrcaHS** to Applications or anywhere you like.

The app is signed ad-hoc, not with an Apple Developer ID. The first time you open a downloaded copy, Gatekeeper will say it is from an unidentified developer. **Right-click the app → Open → Open.** macOS remembers the choice.

### 3. Pair

Launch OrcaHS, paste the `orca://pair?code=…` link into the box and press **Connect**. The Orca interface appears. Next time, OrcaHS opens the last server you used straight away.

## Everyday use

- **Switch or remove servers:** `Cmd+Shift+S` (menu **OrcaHS → Switch Server…**) opens the server picker. It lists every server you have paired with. Removing one forgets the pairing on this Mac; revoke it on the server as well under Settings → Remote Orca Servers.
- **Accepted pairing inputs:** an `orca://pair?code=…` link, the browser URL printed by `orca serve` (`http://<server>:6768/#code=…`), the bare pairing code, or the plain URL of a server you already paired with.
- **If the server goes away:** OrcaHS shows its own page with the error, retries about every 10 seconds, and offers to switch servers. Brief WebSocket drops while the page is open are handled by Orca's own UI.
- **Copy and paste:** copy buttons inside Orca work. Paste with `Cmd+V`. (Right-click → Paste in the terminal does not, see [Limitations](#limitations).)

### Where OrcaHS keeps its data

Everything the app writes lives in one folder. Resolution order:

1. `--base-dir=<folder>` on the command line.
2. **Portable mode:** a folder named `OrcaHS-data` next to `OrcaHS.app`. Create it once and every launch, including from the Dock or Finder, keeps all data there. Good for a USB stick, or for keeping an old Mac tidy.
3. Otherwise `~/Library/Application Support/OrcaHS`.

Example with an explicit folder:

```bash
open -na /Applications/OrcaHS.app --args --base-dir="$HOME/OrcaHS-data"
```

Inside the base directory: `servers.json` (your server list, no secrets), `update-check.json` (when the release check last ran), `updates/` (download scratch space, emptied after each update), `userdata/` (the Chromium profile; it holds the pairing tokens in localStorage, unencrypted, just as a browser would), `logs/`. The directory is created with owner-only permissions. If you keep it on removable media, treat it like a saved browser session.

Other flags: `--url=<pairing link or server url>` to connect to something specific (prefer pasting into the picker: command-line arguments are visible to other processes and shell history), `--prompt` to open the server picker, `--no-update-check` to skip the daily release check, `--hs-debug` to log everything and take screenshots into `logs/`, `--version`.

Logs are scrubbed of pairing codes and long tokens, and `--hs-debug` screenshots show whatever was on screen. Look through both before attaching them to a public issue.

## Updates

OrcaHS checks the GitHub Releases page once a day. When a newer version exists, a small notice appears in the bottom-right corner of the window, like in the official Orca client. **Download and Install** downloads the release zip, verifies its SHA-256 against the release's `SHA256SUMS.txt`, replaces the app bundle in place and restarts; **Later** hides the notice until the next launch. **OrcaHS → Check for Updates…** checks immediately.

Details worth knowing:

- Nothing is downloaded until you click. The check itself is one anonymous `GET` to `api.github.com` with the app's version in the User-Agent. Disable it with `--no-update-check`, or `"disabled": true` in `update-check.json` in the data folder.
- The app must be in a folder you can write to (your home folder, or `/Applications` if you own it). Otherwise the notice offers the release page instead.
- The previous version is kept next to the app as `OrcaHS.app.old-<timestamp>` until the new one starts successfully, then removed.
- Files written by the app carry no quarantine flag, so Gatekeeper does not prompt after an in-app update.
- If a release changes the app icon, macOS 10.13 may keep showing the previous icon for the running app until the next reboot; see [Troubleshooting](#troubleshooting).
- Why not Electron's built-in updater: Squirrel.Mac only installs bundles whose code signature matches the running app, which requires an Apple Developer ID. OrcaHS is signed ad-hoc so anyone can build identical binaries without an Apple account, so it ships its own small updater (`app/updater.js`).

## Using it away from home

OrcaHS needs an IP route to the server; it does not provide one. Options, from simplest:

1. **Same Wi-Fi or hotspot** as the server machine. Nothing to configure.
2. **Tailscale on the server side only.** Current Tailscale clients need macOS 12+, so the old Mac cannot join the tailnet directly. Instead, from a machine that can reach the tailnet, forward a port to the old Mac, or use the next option.
3. **SSH tunnel.** The old Mac has `ssh` built in. If you can SSH to the server machine (directly, through a jump host, or via Tailscale on an intermediate box):

   ```bash
   ssh -N -L 6768:127.0.0.1:6768 user@server
   ```

   Then pair OrcaHS with a link whose address is `127.0.0.1`. On the server, generate the access link with the connection address set to `127.0.0.1`, or run `orca serve --pairing-address 127.0.0.1`.

Do not expose the Orca server port directly to the internet. Orca's remote mode is designed for private networks; the pairing token is the only thing protecting it. Plain `http://` on a LAN is not encrypted: anyone on the same network segment can read or alter the traffic. An SSH tunnel, or HTTPS in front of the server, removes that exposure and is the recommended setup wherever the network is not entirely yours.

## Limitations

- **Old browser engine.** Chromium 116 (August 2023) gets no security updates. Use OrcaHS only against servers you own, on networks you control. The shell runs with `nodeIntegration: false`, `contextIsolation: true` and `sandbox: true`, so remote content has no access to the file system or Node. It is still a 2023 renderer, and a compromised or impersonated server could exploit it like any old browser.
- **Right-click Paste** in terminals is a no-op on plain `http://` connections, because Chromium hides the clipboard-read API on insecure origins. `Cmd+V` works. Copy buttons work through a write-only bridge the shell provides.
- **PDF preview** inside Orca does not render yet (pdf.js needs `Promise.withResolvers` in a Web Worker, which Chromium 116 lacks and the shell cannot polyfill there).
- **Local features are absent by design.** No local worktrees, terminals, agents, Design Mode or computer use on the old Mac. All of that runs on the server.
- **Performance** depends on the old hardware. Terminal rendering uses WebGL and is fine on a 2016 MacBook; very long outputs may show occasional frame drops.
- **Upstream changes.** OrcaHS renders whatever UI the server serves. A future Orca release may start using a browser API that Chromium 116 does not have. Open an issue with the console error from `--hs-debug` logs and it can usually be polyfilled.

## Building from source

Build on any modern Mac. No Xcode or Apple account is needed; the script uses only `curl`, `codesign`, `sips`, `iconutil`, `hdiutil` and Node (any recent version, only to read `package.json` and generate the placeholder icon).

```bash
git clone https://github.com/gabielchong/orca-High-Sierra.git
cd orca-High-Sierra
./build.sh            # → dist/OrcaHS-<version>.zip and dist/OrcaHS-<version>.dmg
```

What `build.sh` does: downloads the official Electron 26.6.10 macOS x64 release and verifies its SHA-256, renames it, drops the files from `app/` into `Contents/Resources/app`, rewrites `Info.plist` (name, bundle id, version, minimum OS 10.13), builds an `.icns` from `resources/icon.png`, signs ad-hoc, and packages a zip and a dmg.

Name, version and bundle id live in `app/package.json`. Replace `resources/icon.png` (1024×1024, transparent margins per Apple's icon grid) to change the icon.

### Copying to the old Mac without a browser

```bash
scp dist/OrcaHS-<version>.zip oldmac:~/Desktop/
ssh oldmac 'cd ~/Desktop && unzip -q OrcaHS-*.zip && open -na ~/Desktop/OrcaHS.app'
```

Files that arrive by `scp` carry no quarantine flag, so Gatekeeper does not prompt.

## Project layout

```
app/
  main.js             Electron main process: window, storage confinement, logging, clipboard IPC, menu
  preload.js          ES2024 polyfills for Chromium 116, clipboard shim, server-picker bridge
  pair-link.js        turns orca:// links, browser URLs and bare codes into the web client URL
  clipboard-policy.js rules for the write-only clipboard bridge
  servers-store.js    paired-server list (pure functions over servers.json)
  prompt.html         server picker
  offline.html        shown when the server cannot be reached
  toast.html          bottom-right update notice with download progress
  update-check.js     release lookup and version comparison
  updater.js          download, verify, swap the bundle, relaunch
  package.json        product name, version, bundle id
  base-dir.js         data folder resolution (--base-dir, portable folder, Application Support)
test/                 unit tests (node --test)
resources/            icon.png and the dependency-free script that generates it
build.sh              packaging script
```

```bash
node --test test/*.test.js
```

## How the shell stays small and safe

- The remote Orca UI is loaded like a web page. It cannot require Node modules, read files, or spawn processes.
- The window may only navigate within the server origin you selected in the picker (or at startup). Redirects and navigations elsewhere are blocked and logged. Links that open a new window go to your system browser only after you confirm a native dialog. Downloads are blocked.
- Browser permissions are denied by default. The trusted server origin gets clipboard write and fullscreen; nothing else (no clipboard read, camera, microphone, notifications, …).
- On plain `http://` servers, where Chromium hides the clipboard API entirely, the shell provides `navigator.clipboard.writeText` through a bridge to the main process, which checks that the request comes from the main frame of the trusted origin, caps the size and rate-limits it.
- The server picker's IPC is exposed only to the shell's own two `file://` pages, verified by exact URL on every call.
- The pairing token is kept in the Chromium profile's localStorage, exactly as Orca's browser client does. `servers.json` holds only origins and paths; log lines are scrubbed of codes and tokens.
- The app writes only inside its base directory. macOS itself still keeps a saved-window-state, shader-cache and preferences entry per app; OrcaHS removes those on start and on a normal quit.

## Troubleshooting

- **"OrcaHS can't be opened because it is from an unidentified developer."** Right-click → Open, once.
- **`open` fails with `LSOpenURLsWithRole() … error -10810`** after replacing the app in place. Launch Services cached the old bundle. Run
  `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /path/to/OrcaHS.app`
  and try again, or start `OrcaHS.app/Contents/MacOS/OrcaHS` directly.
- **Two OrcaHS icons in the Dock** after upgrading from a pre-release build: the pinned one points at the old bundle id. Drag it out and pin the new one.
- **The Dock shows an old icon for the running app** after the app was replaced in place (manual reinstall or in-app update) with a version whose icon changed. On macOS 10.13 the system icon daemon (`iconservicesd`, runs as root) keeps the icon it first rendered for a bundle *path* in memory. Restarting the Dock, clearing the user icon caches, re-registering with Launch Services or deleting `/Library/Caches/com.apple.iconservices.store` do not refresh it; only restarting the daemon does. Either reboot, or:
  ```bash
  sudo killall iconservicesd; killall Dock
  ```
  Moving the app to a different folder also shows the new icon immediately. Fresh installs are never affected. (Found by replacing bundles at the same path on a 10.13.6 machine: the stale icon followed the path, not the bundle, and disappeared after a reboot.)
- **Blank page or a Chromium error instead of Orca.** Run with `--hs-debug` and look in `logs/session-*.log` for `[console:3]` lines; attach them to an issue.
- **Which version is installed?** `OrcaHS.app/Contents/MacOS/OrcaHS --version`

## Relationship to Orca

OrcaHS is an independent community client. It is not affiliated with or endorsed by Stably AI. It contains no Orca code; it loads the web client that your own Orca server serves. Orca itself is MIT licensed at [stablyai/orca](https://github.com/stablyai/orca).

## License

MIT. See [LICENSE](LICENSE). The app bundle ships the notices for everything it contains in `OrcaHS.app/Contents/Resources/licenses/`: this project's license, Electron's MIT license, and Chromium's third-party list (`LICENSES.chromium.html`).

## Contributing

Issues and pull requests are welcome, especially:

- reports of Orca UI features that break on Chromium 116 (please include `--hs-debug` logs),
- testing on other old Macs and macOS versions (10.13, 10.14, 10.15 on unsupported hardware),
- a nicer icon.

Development happens on `develop`; `master` holds releases. Feature and fix branches are merged with `--no-ff`.
