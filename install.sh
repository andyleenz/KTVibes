#!/usr/bin/env bash
# KTVibes installer for Linux and macOS:
#   curl -LsSf https://raw.githubusercontent.com/JeffShih-wiwynn/KTVibes/dev/install.sh | bash
# Installs uv if needed, clones (or updates) KTVibes into ~/KTVibes, installs its Python
# dependencies, and adds a `ktvibes` command to ~/.local/bin.
set -euo pipefail
DIR="${KTVIBES_DIR:-$HOME/KTVibes}"
missing=()
for tool in git ffmpeg node; do command -v "$tool" >/dev/null || missing+=("$tool"); done
if command -v node >/dev/null && (( $(node -p 'process.versions.node.split(".")[0]') < 22 )); then
  echo "Node.js $(node --version) is too old; KTVibes needs 22+ (https://nodejs.org or nvm)."; exit 1
fi
if ((${#missing[@]})); then
  echo "Missing: ${missing[*]}"
  if [[ "$(uname)" == Darwin ]]; then echo "Install with: brew install ${missing[*]}"
  else echo "Install with your package manager, e.g. sudo apt install ${missing[*]/node/nodejs}  (Node.js 22+ needed: distro packages are often older; use https://nodejs.org or nvm)"; fi
  exit 1
fi
if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="${UV_INSTALL_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}:$HOME/.local/bin:$PATH"
fi
REPO="https://github.com/JeffShih-wiwynn/KTVibes.git"
if [[ -d "$DIR/.git" ]]; then
  git -C "$DIR" remote set-url origin "$REPO"
  git -C "$DIR" pull --ff-only
else
  git clone --branch dev "$REPO" "$DIR"
fi
(cd "$DIR" && uv sync --no-dev)
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/ktvibes" <<LAUNCHER
#!/usr/bin/env bash
cd "$DIR" && exec uv run --no-dev ktvibes "\$@"
LAUNCHER
chmod +x "$HOME/.local/bin/ktvibes"
echo
echo "Installed. Run: ktvibes   then open http://localhost:8765 on the TV computer."
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "(Add ~/.local/bin to your PATH, or run $HOME/.local/bin/ktvibes)";; esac
