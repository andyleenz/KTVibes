#!/usr/bin/env bash
# KTVibes installer for Linux and macOS:
#   curl -LsSf https://raw.githubusercontent.com/andyleenz/KTVibes/main/install.sh | bash
# Installs uv if needed, clones (or updates) KTVibes into ~/KTVibes, installs its Python
# dependencies, and adds a `ktvibes` command to ~/.local/bin.
set -euo pipefail
DIR="${KTVIBES_DIR:-$HOME/KTVibes}"
missing=()
for tool in git ffmpeg node; do command -v "$tool" >/dev/null || missing+=("$tool"); done
if ((${#missing[@]})); then
  echo "Missing: ${missing[*]}"
  if [[ "$(uname)" == Darwin ]]; then echo "Install with: brew install ${missing[*]}"
  else echo "Install with your package manager, e.g. sudo apt install ${missing[*]/node/nodejs}  (Node.js 22+ needed)"; fi
  exit 1
fi
if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
if [[ -d "$DIR/.git" ]]; then git -C "$DIR" pull --ff-only; else git clone https://github.com/andyleenz/KTVibes.git "$DIR"; fi
(cd "$DIR" && uv sync --no-dev)
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/ktvibes" <<LAUNCHER
#!/usr/bin/env bash
cd "$DIR" && exec uv run --no-dev ktvibes "\$@"
LAUNCHER
chmod +x "$HOME/.local/bin/ktvibes"
echo
echo "Installed. Run: ktvibes   then open http://localhost:8765/tv on the TV computer."
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "(Add ~/.local/bin to your PATH, or run $HOME/.local/bin/ktvibes)";; esac
