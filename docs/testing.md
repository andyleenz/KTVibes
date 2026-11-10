# Tests

## Installer builds

The Windows installer and macOS Apple silicon DMG workflows build automatically
on pushes to `main` and new `v*` tags. Both also support manual dispatch. Successful
runs upload their installers as Actions artifacts, retained for 14 days. Publishing
these files as GitHub Release assets remains a separate step.

The Windows build also exercises Python setup with a minimal dependency-free
project in a custom folder containing spaces. It checks repeated installation,
repair of a dangling Python junction, rebuilding an unusable virtual environment,
and restoration of the previous environment when dependency synchronization fails.
It also migrates an old junction-based environment and removes the junction to
verify that both the interpreter and application startup work without it.
These checks use Windows PowerShell 5.1. They do not reproduce every Windows
security policy or run the full graphical installer and PyTorch downloads.

## Python tests

```bash
uv sync --locked
uv run --locked pytest
```

The default pytest collection runs `tests/`. Browser tests are selected explicitly.

## Remote browser tests

These tests load the production Remote HTML, CSS and JavaScript from a local static
server. HTTP and WebSocket responses use deterministic fixtures, so YouTube,
LRCLIB, FFmpeg, PyTorch and model downloads are not required.

For a separate browser-test environment (macOS/Linux shell):

```bash
export UV_PROJECT_ENVIRONMENT=.venv-ui
uv sync --locked --only-group ui
uv run --no-sync playwright install chromium
uv run --no-sync pytest ui_tests --browser chromium \
  --tracing retain-on-failure --screenshot only-on-failure
```

Run `unset UV_PROJECT_ENVIRONMENT` afterwards to return to the normal project environment.
Linux machines may need `playwright install --with-deps chromium` instead.

Every test runs with desktop and mobile viewport profiles where applicable.
The suite covers thumb-only sliders, native mobile scrolling over a slider,
seeking with delayed playback updates, queue ordering and actions, duplicate queue
entries, Recent swipes, lyrics selection, search cooldowns, lyric status and the
960px layout breakpoint. Mouse input exercises dragging in both profiles;
Chromium touch input additionally checks native scrolling and gesture arbitration.

The `Remote UI tests` workflow runs on branch pushes, pull requests and manual
dispatch. Failed runs upload screenshots and Playwright traces from `test-results/`.
To inspect a trace, run:

```bash
uv run --no-sync playwright show-trace path/to/trace.zip
```

These tests verify browser behavior against a fixture contract. They do not verify
real backend integration, model inference, audio/video synchronization, Gatekeeper,
or touch behavior on a physical phone. WebKit and furigana screenshot tests can be
added separately after this suite is established.
