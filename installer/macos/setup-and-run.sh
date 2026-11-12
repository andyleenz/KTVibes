#!/bin/bash
set -euo pipefail

SUPPORT="${KTVIBES_APP_SUPPORT:?Missing application support directory}"
RESOURCES="${KTVIBES_APP_RESOURCES:?Missing app resources directory}"
PROJECT="$SUPPORT/project"
TOOLS="$SUPPORT/tools"
CACHE="$SUPPORT/data/cache"
UV_BIN="$TOOLS/uv/uv"
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
    curl --fail --location --silent --show-error --retry 3 https://astral.sh/uv/install.sh | sh
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
    temp="$SUPPORT/ffmpeg.zip"
    download_verified \
        "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip" \
        "" "$temp"
    mkdir -p "$SUPPORT/ffmpeg-unpack"
    ditto -x -k "$temp" "$SUPPORT/ffmpeg-unpack"
    ffmpeg_bin="$(find "$SUPPORT/ffmpeg-unpack" -type f -name ffmpeg -print -quit)"
    [[ -n "$ffmpeg_bin" ]] || { log "FFmpeg archive did not contain ffmpeg"; exit 1; }
    install -m 755 "$ffmpeg_bin" "$FFMPEG_DIR/bin/ffmpeg"
    rm -rf "$SUPPORT/ffmpeg-unpack" "$temp"

    temp="$SUPPORT/ffprobe.zip"
    download_verified \
        "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffprobe.zip" \
        "" "$temp"
    mkdir -p "$SUPPORT/ffprobe-unpack"
    ditto -x -k "$temp" "$SUPPORT/ffprobe-unpack"
    ffprobe_bin="$(find "$SUPPORT/ffprobe-unpack" -type f -name ffprobe -print -quit)"
    [[ -n "$ffprobe_bin" ]] || { log "FFprobe archive did not contain ffprobe"; exit 1; }
    install -m 755 "$ffprobe_bin" "$FFMPEG_DIR/bin/ffprobe"
    rm -rf "$SUPPORT/ffprobe-unpack" "$temp"
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
"$UV_BIN" run --project "$PROJECT" --no-dev ktvibes &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM

server_ready=0
for _ in $(seq 1 120); do
    active_port="$(cat "${KTVIBES_PORT_FILE:-/dev/null}" 2>/dev/null || true)"
    if [[ "$active_port" =~ ^[0-9]+$ ]] && curl --silent --fail "http://127.0.0.1:${active_port}/api/state" >/dev/null; then
        log "KTVIBES_SERVER_READY"
        server_ready=1
        break
    fi
    if ! kill -0 "$server_pid" 2>/dev/null; then
        wait "$server_pid"
        exit $?
    fi
    sleep 1
done
if [[ "$server_ready" != "1" ]]; then
    log "KTVibes did not become ready within 120 seconds."
    exit 1
fi

wait "$server_pid"
