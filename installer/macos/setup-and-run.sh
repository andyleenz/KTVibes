#!/bin/bash
set -euo pipefail

SUPPORT="${KTVIBES_APP_SUPPORT:?Missing application support directory}"
RESOURCES="${KTVIBES_APP_RESOURCES:?Missing app resources directory}"
PROJECT="$SUPPORT/project"
TOOLS="$SUPPORT/tools"
CACHE="$SUPPORT/data/cache"
UV_BIN="$TOOLS/uv/uv"
# Pinned so setup is reproducible; bump together with a release when a newer one is needed.
UV_VERSION="0.13.7"
NODE_VERSION="22.23.4"
NODE_DIR="$TOOLS/node"
FFMPEG_DIR="$TOOLS/ffmpeg"

export UV_INSTALL_DIR="$TOOLS/uv"
export UV_UNMANAGED_INSTALL="$TOOLS/uv"
export UV_PYTHON_INSTALL_DIR="$TOOLS/python"
export UV_CACHE_DIR="$SUPPORT/.uv-cache"
export UV_PROJECT_ENVIRONMENT="$SUPPORT/.venv"
export UV_NO_MODIFY_PATH=1
export UV_HTTP_TIMEOUT=90
export UV_HTTP_RETRIES=3
export KTVIBES_CACHE="$CACHE"
export TORCH_HOME="$CACHE/models"
export PATH="$FFMPEG_DIR/bin:$NODE_DIR/bin:$TOOLS/uv:$PATH"

mkdir -p "$SUPPORT" "$TOOLS" "$CACHE" "$NODE_DIR/bin" "$FFMPEG_DIR/bin"

log() { printf '%s\n' "$1"; }
download_verified() {
    local url="$1" checksum_url="$2" destination="$3" filename expected actual resolved_url
    filename="$(basename "${url%%\?*}")"
    log "Downloading ${filename}…"
    resolved_url="$(curl --fail --location --silent --show-error --retry 3 --connect-timeout 20 --write-out '%{url_effective}' "$url" -o "$destination")"
    if [[ -z "$checksum_url" ]]; then checksum_url="${resolved_url}.sha256"; fi
    expected="$(curl --fail --location --silent --show-error --retry 3 --connect-timeout 20 "$checksum_url" | awk -v file="$filename" '$2 == file {print $1; found=1; exit} END {if (!found && NR == 1) print $1}')"
    [[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || { log "No valid SHA-256 checksum for $filename"; return 1; }
    actual="$(shasum -a 256 "$destination" | awk '{print $1}')"
    actual="$(printf '%s' "$actual" | tr '[:upper:]' '[:lower:]')"
    expected="$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')"
    [[ "$actual" == "$expected" ]] || { log "SHA-256 mismatch for $filename"; return 1; }
}

if [[ "$(uname -m)" != "arm64" ]]; then
    log "This KTVibes build supports Apple silicon Macs only."
    exit 1
fi

if [[ ! -x "$UV_BIN" ]]; then
    log "Installing the private uv runtime…"
    temp="$SUPPORT/uv.tar.gz"
    download_verified \
        "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-aarch64-apple-darwin.tar.gz" \
        "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-aarch64-apple-darwin.tar.gz.sha256" "$temp"
    mkdir -p "$TOOLS/uv"
    tar -xzf "$temp" --strip-components=1 -C "$TOOLS/uv"
    rm -f "$temp"
    [[ -x "$UV_BIN" ]] || { log "uv archive did not contain uv"; exit 1; }
fi

if [[ ! -x "$NODE_DIR/bin/node" ]]; then
    temp="$SUPPORT/node.tar.gz"
    archive="node-v$NODE_VERSION-darwin-arm64.tar.gz"
    checksum_url="https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
    download_verified "https://nodejs.org/dist/v$NODE_VERSION/$archive" "$checksum_url" "$temp"
    mkdir -p "$NODE_DIR/dist"
    tar -xzf "$temp" --strip-components=1 -C "$NODE_DIR/dist"
    ln -sf ../dist/bin/node "$NODE_DIR/bin/node"
    rm -f "$temp"
fi

if [[ ! -x "$FFMPEG_DIR/bin/ffmpeg" || ! -x "$FFMPEG_DIR/bin/ffprobe" ]]; then
    log "Downloading Apple silicon FFmpeg and FFprobe…"
    for tool in ffmpeg ffprobe; do
        temp="$SUPPORT/$tool.zip"
        download_verified \
            "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/$tool.zip" \
            "" "$temp"
        mkdir -p "$SUPPORT/$tool-unpack"
        ditto -x -k "$temp" "$SUPPORT/$tool-unpack"
        tool_bin="$(find "$SUPPORT/$tool-unpack" -type f -name "$tool" -print -quit)"
        [[ -n "$tool_bin" ]] || { log "The $tool archive did not contain $tool"; exit 1; }
        install -m 755 "$tool_bin" "$FFMPEG_DIR/bin/$tool"
        rm -rf "$SUPPORT/$tool-unpack" "$temp"
    done
fi

log "Preparing KTVibes files…"
mkdir -p "$PROJECT"
rsync -a --delete --exclude='.DS_Store' "$RESOURCES/project/" "$PROJECT/"

if ! "$UV_BIN" python find 3.12 >/dev/null 2>&1; then
    log "Downloading the private Python 3.12 runtime…"
    "$UV_BIN" python install 3.12
fi

log "Installing KTVibes packages. PyTorch may take several minutes on first setup…"
"$UV_BIN" sync --project "$PROJECT" --locked --no-dev --python 3.12

log "Starting the KTVibes server…"
cd "$PROJECT"
"$UV_BIN" run --project "$PROJECT" --locked --no-dev ktvibes &
server_pid=$!  # it opens the browser itself (KTVIBES_OPEN_BROWSER, set by the app)
# uv may run the server as a child; stop that too so quitting the app frees the port.
trap 'pkill -P "$server_pid" 2>/dev/null || true; kill "$server_pid" 2>/dev/null || true' EXIT INT TERM

wait "$server_pid"
