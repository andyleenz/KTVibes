# KTVibes installer for Windows (PowerShell):
# In PowerShell:
#   irm https://raw.githubusercontent.com/andyleenz/KTVibes/main/install.ps1 | iex
# Installs missing tools with winget, clones (or updates) KTVibes into ~\KTVibes, installs its
# Python dependencies, and adds a `ktvibes` command.
$ErrorActionPreference = "Stop"
# External programs don't throw on failure; stop on a non-zero exit code.
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)" } }
$dir = if ($env:KTVIBES_DIR) { $env:KTVIBES_DIR } else { Join-Path $HOME "KTVibes" }
$tools = @{ git = "Git.Git"; ffmpeg = "Gyan.FFmpeg"; node = "OpenJS.NodeJS.LTS"; uv = "astral-sh.uv" }
foreach ($tool in $tools.Keys) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        winget install --id $tools[$tool] -e --accept-source-agreements --accept-package-agreements
    }
}
# Pick up tools winget just installed.
function Refresh { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }
Refresh
# Node.js has been seen missing after the first pass on Windows 11 Home; try once more and show why.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    Write-Host "winget exit code for Node.js: $LASTEXITCODE"
    Refresh
}
if (Test-Path (Join-Path $dir ".git")) { git -C $dir pull --ff-only; Check "git pull" } else { git clone https://github.com/andyleenz/KTVibes.git $dir; Check "git clone" }
Push-Location $dir; uv sync --no-dev; $synced = $LASTEXITCODE; Pop-Location
if ($synced -ne 0) { throw "uv sync failed (exit code $synced)" }
$bin = Join-Path $HOME ".local\bin"
New-Item -ItemType Directory -Force $bin | Out-Null
Set-Content (Join-Path $bin "ktvibes.cmd") "@echo off`r`nsetlocal`r`ncd /d `"$dir`" && uv run --no-dev ktvibes %*"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$bin*") { [Environment]::SetEnvironmentVariable("Path", "$userPath;$bin", "User") }
$missing = @("ffmpeg", "ffprobe", "node") | Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) }
if ($missing) { Write-Warning "Not on PATH yet: $($missing -join ', '). Open a NEW terminal before running ktvibes." }
if ($missing -contains "node") { Write-Warning "If Node.js is still missing in a new terminal, install the LTS version from https://nodejs.org" }
Write-Host "`nInstalled. Open a new terminal, run: ktvibes   then open http://localhost:8765"
