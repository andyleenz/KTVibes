#!/bin/bash
set -euo pipefail

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

sips -s format icns "$ROOT/docs/icon-512.png" --out "$RESOURCES/KTVibes.icns" >/dev/null

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

DMG="$OUTPUT/KTVibes-AppleSilicon.dmg"
STAGE="$OUTPUT/.dmg-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/KTVibes.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "KTVibes" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"
echo "Built: $APP"
echo "Built: $DMG"
