#!/usr/bin/env bash
# Build OrcaHS.app: an Electron 26 (last release supporting macOS 10.13) thin client that loads a
# Remote Orca Server's web UI. Runs on the modern dev Mac; produces dist/OrcaHS-<version>.dmg and .zip
# to copy to the target machine. Signing is ad-hoc on purpose: no Apple ID or Team ID is involved.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_VERSION="${ELECTRON_VERSION:-26.6.10}"
ARCH="${ARCH:-x64}"
OUT="${OUT:-$HERE/dist}"
DL="$OUT/download"
mkdir -p "$DL"

read_pkg() { node -p "require('$HERE/app/package.json').$1"; }
PRODUCT="$(read_pkg productName)"
VERSION="$(read_pkg version)"
BUNDLE_ID="$(read_pkg bundleId)"

# 1. Official Electron release, checksum-verified.
ZIP="$DL/electron-v$ELECTRON_VERSION-darwin-$ARCH.zip"
if [ ! -f "$ZIP" ]; then
  curl -fsSL -o "$ZIP" "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-darwin-$ARCH.zip"
  curl -fsSL -o "$DL/SHASUMS256.txt" "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/SHASUMS256.txt"
fi
expected="$(grep " \*electron-v$ELECTRON_VERSION-darwin-$ARCH.zip" "$DL/SHASUMS256.txt" | cut -d' ' -f1)"
actual="$(shasum -a 256 "$ZIP" | cut -d' ' -f1)"
[ "$expected" = "$actual" ] || { echo "checksum mismatch for $ZIP" >&2; exit 1; }

# 2. Stage the bundle.
STAGE="$OUT/stage"
rm -rf "$STAGE" && mkdir -p "$STAGE"
ditto -x -k "$ZIP" "$STAGE"
APP_DIR="$STAGE/$PRODUCT.app"
mv "$STAGE/Electron.app" "$APP_DIR"
RES="$APP_DIR/Contents/Resources"
mkdir -p "$RES/app"
cp "$HERE"/app/*.js "$HERE"/app/*.html "$HERE/app/package.json" "$RES/app/"
rm -f "$RES/default_app.asar"

# 3. Identity: name, bundle id, version, executable name, minimum OS.
PL="$APP_DIR/Contents/Info.plist"
mv "$APP_DIR/Contents/MacOS/Electron" "$APP_DIR/Contents/MacOS/$PRODUCT"
PB=/usr/libexec/PlistBuddy
$PB -c "Set :CFBundleName $PRODUCT" -c "Set :CFBundleDisplayName $PRODUCT" -c "Set :CFBundleExecutable $PRODUCT" \
    -c "Set :CFBundleIdentifier $BUNDLE_ID" -c "Set :CFBundleShortVersionString $VERSION" -c "Set :CFBundleVersion $VERSION" \
    -c "Set :LSMinimumSystemVersion 10.13" "$PL"
$PB -c "Add :NSHumanReadableCopyright string ''" "$PL" 2>/dev/null || $PB -c "Set :NSHumanReadableCopyright ''" "$PL"
# Helper bundles keep Electron's ids but get a distinct prefix so they do not collide with a real Electron install.
for helper in "$APP_DIR"/Contents/Frameworks/*Helper*.app; do
  hp="$helper/Contents/Info.plist"
  hid="$($PB -c 'Print :CFBundleIdentifier' "$hp")"
  $PB -c "Set :CFBundleIdentifier ${hid/com.github.Electron/$BUNDLE_ID}" "$hp"
done

# 4. Icon: PNG -> icns with Apple's tools.
ICON_PNG="$HERE/resources/icon.png"
[ -f "$ICON_PNG" ] || node "$HERE/resources/make-icon.mjs"
ICONSET="$OUT/icon.iconset"; rm -rf "$ICONSET"; mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size "$ICON_PNG" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size*2)) $((size*2)) "$ICON_PNG" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RES/$PRODUCT.icns"
rm -f "$RES/electron.icns"
$PB -c "Set :CFBundleIconFile $PRODUCT.icns" "$PL"

# 5. Ad-hoc signature (no identity, no Team ID). First launch of a downloaded copy needs right-click → Open.
codesign --force --deep --sign - "$APP_DIR"
codesign --verify --deep --strict "$APP_DIR"

# 6. Artifacts: zip (for scp) and dmg (for download / Finder install).
ZIP_OUT="$OUT/$PRODUCT-$VERSION.zip"
DMG_OUT="$OUT/$PRODUCT-$VERSION.dmg"
rm -f "$ZIP_OUT" "$DMG_OUT"
(cd "$STAGE" && ditto -c -k --keepParent "$PRODUCT.app" "$ZIP_OUT")
DMG_ROOT="$OUT/dmg-root"; rm -rf "$DMG_ROOT"; mkdir -p "$DMG_ROOT"
cp -R "$APP_DIR" "$DMG_ROOT/"
ln -s /Applications "$DMG_ROOT/Applications"
hdiutil create -quiet -volname "$PRODUCT $VERSION" -srcfolder "$DMG_ROOT" -ov -format UDZO "$DMG_OUT"
rm -rf "$DMG_ROOT" "$ICONSET"

echo "built:"
for f in "$ZIP_OUT" "$DMG_OUT"; do echo "  $f  $(shasum -a 256 "$f" | cut -c1-16)  $(du -h "$f" | cut -f1)"; done
echo "install on target (zip): unzip into ~/Desktop/$PRODUCT, then:"
echo "  open -na ~/Desktop/$PRODUCT/$PRODUCT.app --args --base-dir=\$HOME/Desktop/$PRODUCT/data"
