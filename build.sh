#!/usr/bin/env bash
# Build OrcaHS.app: an Electron 26 (last release supporting macOS 10.13) thin client that
# loads a Remote Orca Server's web UI. Runs on the modern dev Mac; output is a zip to copy
# to the target machine's ~/Desktop.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_VERSION="${ELECTRON_VERSION:-26.6.10}"
ARCH="${ARCH:-x64}"
OUT="${OUT:-$HERE/dist}"
DL="$OUT/download"
mkdir -p "$DL"
ZIP="$DL/electron-v$ELECTRON_VERSION-darwin-$ARCH.zip"
if [ ! -f "$ZIP" ]; then
  curl -fsSL -o "$ZIP" "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-darwin-$ARCH.zip"
  curl -fsSL -o "$DL/SHASUMS256.txt" "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/SHASUMS256.txt"
fi
expected="$(grep " \*electron-v$ELECTRON_VERSION-darwin-$ARCH.zip" "$DL/SHASUMS256.txt" | cut -d' ' -f1)"
actual="$(shasum -a 256 "$ZIP" | cut -d' ' -f1)"
[ "$expected" = "$actual" ] || { echo "checksum mismatch for $ZIP" >&2; exit 1; }

STAGE="$OUT/stage"
rm -rf "$STAGE" && mkdir -p "$STAGE"
ditto -x -k "$ZIP" "$STAGE"
mv "$STAGE/Electron.app" "$STAGE/OrcaHS.app"
APP="$STAGE/OrcaHS.app/Contents/Resources/app"
mkdir -p "$APP"
cp "$HERE/app/main.js" "$HERE/app/preload.js" "$HERE/app/pair-link.js" "$HERE/app/clipboard-policy.js" "$HERE/app/prompt.html" "$HERE/app/offline.html" "$HERE/app/package.json" "$APP/"
PL="$STAGE/OrcaHS.app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName OrcaHS" -c "Set :CFBundleDisplayName OrcaHS" -c "Set :CFBundleIdentifier dev.hs.orca-poc" "$PL"
codesign --force --deep --sign - "$STAGE/OrcaHS.app"
(cd "$STAGE" && ditto -c -k --keepParent OrcaHS.app "$OUT/OrcaHS.zip")
echo "built: $OUT/OrcaHS.zip ($(shasum -a 256 "$OUT/OrcaHS.zip" | cut -c1-16))"
echo "install on target: unzip into ~/Desktop/OrcaHS, then:"
echo "  open -na ~/Desktop/OrcaHS/OrcaHS.app --args --base-dir=\$HOME/Desktop/OrcaHS/data"
