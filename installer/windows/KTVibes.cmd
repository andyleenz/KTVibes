@echo off
setlocal
set "APP_DIR=%~dp0"
set "PATH=%APP_DIR%tools\ffmpeg\bin;%APP_DIR%tools\node;%APP_DIR%tools\uv;%PATH%"
set "UV_PYTHON_INSTALL_DIR=%APP_DIR%tools\python"
set "UV_CACHE_DIR=%APP_DIR%.uv-cache"
set "TORCH_HOME=%APP_DIR%cache\models"
if not "%KTVIBES_OPEN_BROWSER%"=="0" set "KTVIBES_OPEN_BROWSER=1"
cd /d "%APP_DIR%"
"%APP_DIR%tools\uv\uv.exe" run --locked --no-dev ktvibes
