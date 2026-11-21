#!/usr/bin/env bash
# Builds dist/linux/KTVibes-x86_64.AppImage: AppRun plus the project files. AppRun fetches uv, Node.js,
# FFmpeg and the Python packages on first start, so the image stays small.
# The name carries no version so releases/latest/download/KTVibes-x86_64.AppImage stays a stable link;
# the version lives in the AppImage metadata and the release tag.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="${1:-$ROOT/dist/linux}"
APPDIR="$OUTPUT/KTVibes.AppDir"
IMAGE="$OUTPUT/KTVibes-x86_64.AppImage"
TOOLS="$OUTPUT/.tools"
VERSION="$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$ROOT/pyproject.toml" | head -n 1)"
# Pinned appimagetool, and the runtime it embeds (by default it fetches the moving "continuous" one).
TOOL_URL=https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage
TOOL_SHA256=ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0
RUNTIME_URL=https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64
RUNTIME_SHA256=2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d

[[ -n "$VERSION" ]] || { echo "Could not read project version" >&2; exit 1; }

fetch() {  # url sha256 file: reuse a copy that already verifies
    [[ -f $3 ]] && echo "$2  $3" | sha256sum -c --quiet - 2>/dev/null && return
    curl -fsSL --retry 3 -o "$3.part" "$1"
    echo "$2  $3.part" | sha256sum -c --quiet - || { echo "Checksum mismatch for $1" >&2; exit 1; }
    mv "$3.part" "$3"
}

rm -rf "$APPDIR" "$IMAGE"
mkdir -p "$APPDIR/project" "$APPDIR/usr/share/icons/hicolor/512x512/apps" "$TOOLS"

install -m 755 "$ROOT/installer/linux/AppRun" "$APPDIR/AppRun"
install -m 644 "$ROOT/installer/linux/ktvibes.desktop" "$APPDIR/ktvibes.desktop"
install -m 644 "$ROOT/installer/linux/THIRD_PARTY_NOTICES.txt" "$APPDIR/THIRD_PARTY_NOTICES.txt"
# AppImage reads the icon from the root and .DirIcon; desktop integration tools look under usr/share/icons.
install -m 644 "$ROOT/docs/icon-512.png" "$APPDIR/ktvibes.png"
ln -s ktvibes.png "$APPDIR/.DirIcon"
install -m 644 "$ROOT/docs/icon-512.png" "$APPDIR/usr/share/icons/hicolor/512x512/apps/ktvibes.png"

tar -C "$ROOT" --exclude=__pycache__ --exclude='*.pyc' --exclude=.venv --exclude=cache --exclude=.DS_Store \
    -cf - ktvibes static | tar -C "$APPDIR/project" -xf -
install -m 644 "$ROOT/pyproject.toml" "$ROOT/uv.lock" "$ROOT/LICENSE" "$APPDIR/project/"

fetch "$RUNTIME_URL" "$RUNTIME_SHA256" "$TOOLS/runtime-x86_64"
if tool="$(command -v appimagetool)"; then
    args=()
else
    fetch "$TOOL_URL" "$TOOL_SHA256" "$TOOLS/appimagetool"
    chmod +x "$TOOLS/appimagetool"
    tool="$TOOLS/appimagetool"
    args=(--appimage-extract-and-run)  # no FUSE on CI runners
fi
ARCH=x86_64 VERSION="$VERSION" "$tool" "${args[@]}" --runtime-file "$TOOLS/runtime-x86_64" "$APPDIR" "$IMAGE"
echo "Built: $IMAGE ($VERSION)"
