param(
    [Parameter(Mandatory = $true)][string]$InstallDir
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$ToolsDir = Join-Path $InstallDir 'tools'
$UvDir = Join-Path $ToolsDir 'uv'
$PythonDir = Join-Path $ToolsDir 'python'
$NodeDir = Join-Path $ToolsDir 'node'
$FfmpegDir = Join-Path $ToolsDir 'ffmpeg'
$CacheDir = Join-Path $InstallDir 'cache'
$UvCacheDir = Join-Path $InstallDir '.uv-cache'
$TempDir = Join-Path $InstallDir '.installer-temp'
$SetupLog = Join-Path $InstallDir 'setup.log'
$StatusFile = Join-Path $InstallDir '.installer-status'
$ResultFile = Join-Path $InstallDir '.installer-result'
$SetupExitCode = 0

function Set-InstallStatus([string]$Message) {
    Set-Content -LiteralPath $StatusFile -Value $Message -Encoding ASCII
}

function Invoke-WithRetry([scriptblock]$Action, [string]$Description) {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try { return & $Action }
        catch {
            if ($attempt -eq 3) { throw }
            Write-Host "$Description failed (attempt $attempt of 3); retrying in $($attempt * 3)s: $($_.Exception.Message)"
            Start-Sleep -Seconds ($attempt * 3)
        }
    }
}

function Get-GitHubReleaseAsset([string]$Repository, [string]$Pattern, [string]$Destination) {
    Write-Host "Checking latest $Repository release..."
    $release = Invoke-WithRetry { Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/latest" -Headers @{ 'User-Agent' = 'KTVibes-Installer' } -TimeoutSec 60 } "Checking $Repository release"
    $asset = $release.assets | Where-Object { $_.name -like $Pattern } | Select-Object -First 1
    if (-not $asset) { throw "Could not find $Pattern in the latest $Repository release." }
    if ($asset.digest -notmatch '^sha256:[0-9a-fA-F]{64}$') { throw "No SHA-256 digest was published for $($asset.name); refusing to install an unverifiable download." }
    Write-Host "Downloading $($asset.name)..."
    Invoke-WithRetry { Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $Destination -TimeoutSec 120 } "Downloading $($asset.name)" | Out-Null
    $actual = (Get-FileHash -Path $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $asset.digest.Substring(7).ToLowerInvariant()) { throw "SHA-256 verification failed for $($asset.name)." }
    return $asset
}

function Expand-ToolArchive([string]$Archive, [string]$Destination, [string]$ExpectedExecutable) {
    $staging = Join-Path $TempDir ([guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force $staging | Out-Null
    Expand-Archive -LiteralPath $Archive -DestinationPath $staging -Force
    $found = Get-ChildItem -Path $staging -Filter $ExpectedExecutable -File -Recurse | Select-Object -First 1
    if (-not $found) { throw "Archive did not contain $ExpectedExecutable." }
    $sourceRoot = $found.Directory.FullName
    $archiveRoot = $sourceRoot
    if ($found.Directory.Name -eq 'bin') { $archiveRoot = $found.Directory.Parent.FullName }
    if ($ExpectedExecutable -eq 'ffmpeg.exe' -and $found.Directory.Name -eq 'bin') {
        $sourceRoot = $found.Directory.Parent.FullName
    }
    if (Test-Path $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
    New-Item -ItemType Directory -Force $Destination | Out-Null
    Get-ChildItem -LiteralPath $sourceRoot -Force | Move-Item -Destination $Destination -Force
    if ($ExpectedExecutable -eq 'node.exe') {
        Get-ChildItem -LiteralPath $archiveRoot -Filter 'LICENSE*' -File | Copy-Item -Destination $Destination -Force
    }
    Remove-Item -LiteralPath $staging -Recurse -Force
}

try {
    Start-Transcript -Path $SetupLog -Force | Out-Null
    Write-Host 'Preparing KTVibes runtime in:' $InstallDir
    Set-InstallStatus 'Preparing the KTVibes runtime...'
    New-Item -ItemType Directory -Force $UvDir, $PythonDir, $NodeDir, $FfmpegDir, $CacheDir, $UvCacheDir, $TempDir | Out-Null
    $env:UV_INSTALL_DIR = $UvDir
    $env:UV_UNMANAGED_INSTALL = $UvDir
    $env:UV_PYTHON_INSTALL_DIR = $PythonDir
    $env:UV_CACHE_DIR = $UvCacheDir
    $env:UV_NO_MODIFY_PATH = '1'
    $env:UV_HTTP_TIMEOUT = '90'
    $env:UV_HTTP_CONNECT_TIMEOUT = '15'
    $env:UV_HTTP_RETRIES = '3'

    $uvArchive = Join-Path $TempDir 'uv.zip'
    Set-InstallStatus 'Downloading the uv package manager...'
    Get-GitHubReleaseAsset 'astral-sh/uv' 'uv-x86_64-pc-windows-msvc.zip' $uvArchive | Out-Null
    Expand-ToolArchive $uvArchive $UvDir 'uv.exe'

    Set-InstallStatus 'Downloading Node.js...'
    Write-Host 'Checking the latest Node.js 22 LTS release...'
    $nodeIndex = Invoke-WithRetry { Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 60 } 'Checking Node.js release'
    $nodeRelease = $nodeIndex | Where-Object { $_.version -match '^v22\.' -and $_.lts } | Select-Object -First 1
    if (-not $nodeRelease) { throw 'Could not find the latest Node.js 22 LTS release.' }
    $nodeVersion = $nodeRelease.version
    $nodeArchiveName = "node-$nodeVersion-win-x64.zip"
    $nodeBase = "https://nodejs.org/dist/$nodeVersion"
    $checksums = (Invoke-WithRetry { Invoke-WebRequest -UseBasicParsing -Uri "$nodeBase/SHASUMS256.txt" -TimeoutSec 60 } 'Downloading Node.js checksums').Content
    $expected = [regex]::Match($checksums, "(?m)^([0-9a-fA-F]{64})\s+$([regex]::Escape($nodeArchiveName))$")
    if (-not $expected.Success) { throw "Could not find a checksum for $nodeArchiveName." }
    $nodeArchive = Join-Path $TempDir $nodeArchiveName
    Write-Host "Downloading $nodeArchiveName..."
    Invoke-WithRetry { Invoke-WebRequest -UseBasicParsing -Uri "$nodeBase/$nodeArchiveName" -OutFile $nodeArchive -TimeoutSec 120 } 'Downloading Node.js' | Out-Null
    if ((Get-FileHash $nodeArchive -Algorithm SHA256).Hash -ne $expected.Groups[1].Value) { throw 'Node.js SHA-256 verification failed.' }
    Expand-ToolArchive $nodeArchive $NodeDir 'node.exe'

    Set-InstallStatus 'Downloading FFmpeg...'
    $ffmpegArchive = Join-Path $TempDir 'ffmpeg.zip'
    $ffmpegAsset = Get-GitHubReleaseAsset 'BtbN/FFmpeg-Builds' 'ffmpeg-master-latest-win64-lgpl.zip' $ffmpegArchive
    Expand-ToolArchive $ffmpegArchive $FfmpegDir 'ffmpeg.exe'
    @(
        "FFmpeg build: $($ffmpegAsset.name)",
        "Release: $($ffmpegAsset.browser_download_url)",
        'License: LGPL build. See the bundled FFmpeg license files and https://ffmpeg.org/legal.html',
        'Source/build project: https://github.com/BtbN/FFmpeg-Builds'
    ) | Set-Content -LiteralPath (Join-Path $FfmpegDir 'BUILD-NOTICE.txt') -Encoding UTF8

    $env:PATH = "$(Join-Path $FfmpegDir 'bin');$NodeDir;$UvDir;$env:PATH"
    $env:TORCH_HOME = Join-Path $CacheDir 'models'
    $uv = Join-Path $UvDir 'uv.exe'
    Push-Location $InstallDir
    try {
        Set-InstallStatus 'Installing the private Python runtime...'
        Write-Host 'Downloading the private Python 3.12 runtime...'
        & $uv python install 3.12
        $pythonExitCode = $LASTEXITCODE
        $pythonInstall = Get-ChildItem -LiteralPath $PythonDir -Filter 'python.exe' -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.Directory.Name -match '^cpython-3\.12\.' } |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
        if (-not $pythonInstall) { throw 'Could not install the private Python 3.12 runtime.' }
        $pythonExecutable = $pythonInstall.FullName
        & $pythonExecutable --version
        if ($LASTEXITCODE -ne 0) { throw 'The installed private Python 3.12 runtime could not be started.' }
        if ($pythonExitCode -ne 0) {
            Write-Host 'uv could not create its Python minor-version junction; using the installed Python executable directly.'
        }
        Set-InstallStatus 'Installing KTVibes and Python packages (PyTorch may take several minutes)...'
        Write-Host 'Installing KTVibes and Python packages. PyTorch downloads can take several minutes...'
        & $uv sync --locked --no-dev --python $pythonExecutable
        if ($LASTEXITCODE -ne 0) { throw 'Could not install KTVibes dependencies.' }
    }
    finally { Pop-Location }
    Set-InstallStatus 'Cleaning up temporary installation files...'
    Write-Host 'Removing temporary package downloads...'
    Remove-Item -LiteralPath $UvCacheDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    Stop-Transcript | Out-Null
    Set-InstallStatus 'Installation complete.'
}
catch {
    try { Stop-Transcript | Out-Null } catch { }
    Write-Host "KTVibes setup failed: $($_.Exception.Message)"
    $SetupExitCode = 1
}
Set-Content -LiteralPath $ResultFile -Value $SetupExitCode -Encoding ASCII
exit $SetupExitCode
