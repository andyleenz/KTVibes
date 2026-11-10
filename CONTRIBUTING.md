# Contributing

Thanks for wanting to help. KTVibes is a small home karaoke app, and small changes are the easiest ones to review and merge.

## Set up and try it

```bash
uv sync
uv run pytest        # about 5 s; .venv/bin/python -m pytest -q works too
uv run ktvibes
```

Open `http://localhost:8765` for the TV and `http://localhost:8765/remote` for the phone remote. You need `ffmpeg` and Node.js 22+ on your PATH; the [README](README.md#install) has the details. The frontend is served straight from `static/`, so reload the page to see an edit.

## Making a change

- **One feature or fix per pull request.** A change that touches one thing can be reviewed in minutes. If your work grew into several parts, send them as separate PRs, each on its own.
- **Open an issue first for anything large**, such as a new screen, a new provider or a change to how songs are prepared. A few lines of "I'd like to do X this way" saves you from building something that has to change.
- **Push once it is ready, then respond to review with new commits.** There is no need to rebase or force-push while we talk.
- **Fork maintainers are welcome to upstream pieces.** If you have a fork with features in it, pick the smallest one and open a PR for it. Features can land one at a time.

## House style

- No frontend build step. The frontend is plain HTML, CSS and JavaScript in `static/`; please do not add a bundler, framework or npm packages.
- Keep code terse. Comments say why, not what.
- The remote has two themes, the default and Classic. Check both after a change to the remote.
- Add a test where one is practical (`tests/`). If a bug is fixed, the test should fail without the fix.
- A user-visible change gets one line in [CHANGELOG.md](CHANGELOG.md) under Unreleased.
- Installer changes (`installer/`) are built by CI on the pull request. They cannot be tried on Linux, so say in the PR how you tested them.

## Pull requests

Describe what changed and why in a few sentences, and what you ran to check it. Screenshots help for anything visual. Run `uv run pytest` before you push.
