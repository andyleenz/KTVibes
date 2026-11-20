#!/bin/bash
set -euo pipefail

# Signing is optional, so anyone can build. With a Developer ID the app opens without Gatekeeper's warning:
#   KTVIBES_SIGN_IDENTITY  "Developer ID Application: Name (TEAMID)", from a keychain on this Mac
#   KTVIBES_NOTARY_PROFILE a notarytool keychain profile (xcrun notarytool store-credentials); needs the identity

# The DMG name carries no version so releases/latest/download/KTVibes-AppleSilicon.dmg stays a stable link;
# the version lives in Info.plist and in the release tag.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="${1:-$ROOT/dist/macos}"
APP="$OUTPUT/KTVibes.app"
CONTENTS="$APP/Contents"
RESOURCES="$CONTENTS/Resources"
VERSION="$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$ROOT/pyproject.toml" | head -n 1)"

[[ -n "$VERSION" ]] || { echo "Could not read project version" >&2; exit 1; }
[[ "$(uname -m)" == "arm64" ]] || { echo "Build this installer on an Apple silicon Mac" >&2; exit 1; }

rm -rf "$APP" "$OUTPUT/KTVibes-AppleSilicon.dmg"
mkdir -p "$CONTENTS/MacOS" "$RESOURCES/project"

swiftc -O -parse-as-library -target arm64-apple-macos13.0 \
    -module-cache-path "$OUTPUT/ModuleCache" \
    "$ROOT/installer/macos/App.swift" \
    -o "$CONTENTS/MacOS/KTVibes"
rm -rf "$OUTPUT/ModuleCache"
install -m 755 "$ROOT/installer/macos/setup-and-run.sh" "$RESOURCES/setup-and-run.sh"

rsync -a --delete \
    --exclude='.DS_Store' --exclude='__pycache__' --exclude='*.pyc' --exclude='.venv' --exclude='cache' \
    "$ROOT/ktvibes/" "$RESOURCES/project/ktvibes/"
rsync -a --delete --exclude='.DS_Store' "$ROOT/static/" "$RESOURCES/project/static/"
install -m 644 "$ROOT/pyproject.toml" "$ROOT/uv.lock" "$ROOT/LICENSE" "$RESOURCES/project/"
install -m 644 "$ROOT/installer/macos/THIRD_PARTY_NOTICES.txt" "$RESOURCES/THIRD_PARTY_NOTICES.txt"

# Every size Finder and the Dock ask for; an .icns holding only 512px shows as a blank icon.
ICONSET="$OUTPUT/KTVibes.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$ROOT/docs/icon-512.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z "$double" "$double" "$ROOT/docs/icon-512.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RESOURCES/KTVibes.icns"
rm -rf "$ICONSET"

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key><string>en</string>
    <key>CFBundleExecutable</key><string>KTVibes</string>
    <key>CFBundleIconFile</key><string>KTVibes</string>
    <key>CFBundleIdentifier</key><string>app.ktvibes.desktop</string>
    <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
    <key>CFBundleName</key><string>KTVibes</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>$VERSION</string>
    <key>CFBundleVersion</key><string>$VERSION</string>
    <key>LSMinimumSystemVersion</key><string>13.0</string>
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

SIGN="${KTVIBES_SIGN_IDENTITY:-}"
NOTARY="${KTVIBES_NOTARY_PROFILE:-}"
[[ -z "$NOTARY" || -n "$SIGN" ]] || { echo "Notarizing needs KTVIBES_SIGN_IDENTITY too" >&2; exit 1; }
if [[ -n "$SIGN" ]]; then
    # Hardened runtime and a secure timestamp are what notarization asks for; the app needs no entitlements.
    codesign --force --options runtime --timestamp --sign "$SIGN" "$APP"
    codesign --verify --strict --verbose=2 "$APP"
fi

DMG="$OUTPUT/KTVibes-AppleSilicon.dmg"
STAGE="$OUTPUT/.dmg-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/KTVibes.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "KTVibes" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"
if [[ -n "$SIGN" ]]; then
    codesign --force --timestamp --sign "$SIGN" "$DMG"
fi
if [[ -n "$NOTARY" ]]; then
    # Notarizing the disk image covers the app inside it; stapling lets Gatekeeper pass it offline too.
    xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY" --wait
    xcrun stapler staple "$DMG"
    spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"
fi
echo "Built: $APP"
echo "Built: $DMG${SIGN:+ (signed)}${NOTARY:+ (notarized)}"
