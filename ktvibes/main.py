"""CLI entry point and the default ASGI application."""
import os
from . import worker
from .application import create_app
from .runtime import PROJECT_ROOT

ROOT = PROJECT_ROOT
app = create_app()

def update():
    """`ktvibes update`: pull the latest version. The next `ktvibes` (uv run) installs any new dependencies."""
    import subprocess
    import sys
    git = lambda *args: subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True)
    if not (ROOT / ".git").exists():
        sys.exit(f"{ROOT} is not a git checkout; download the new version from https://github.com/andyleenz/KTVibes")
    if git("status", "--porcelain", "--untracked-files=no").stdout.strip():
        sys.exit(f"{ROOT} has local changes; commit or stash them, then run ktvibes update again.")
    before = git("rev-parse", "--short", "HEAD").stdout.strip()
    pulled = git("pull", "--ff-only")
    if pulled.returncode:
        sys.exit(pulled.stderr.strip() or "git pull failed")
    after = git("rev-parse", "--short", "HEAD").stdout.strip()
    print("Already up to date." if before == after else f"Updated {before} -> {after}. Stop KTVibes if it is running, then start it again: ktvibes")


def run():
    """`uv run ktvibes`: one process only, since queue state and the model live in memory."""
    import sys
    if sys.argv[1:] == ["update"]:
        return update()
    import uvicorn
    import socket
    from pathlib import Path
    preferred = app.state.runtime.port
    candidates = list(range(preferred, min(preferred + 5, 65536)))
    candidates += list(range(preferred + 10000, min(preferred + 10005, 65536)))
    listener = None
    if os.environ.get('KTVIBES_AUTO_PORT') == '1':
        for candidate in candidates:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                sock.bind(('0.0.0.0', candidate))
                sock.listen(2048)
            except OSError:
                sock.close()
                continue
            listener = sock
            app.state.runtime.port = candidate
            break
        if listener is None:
            print('KTVIBES_PORT_CONFLICT', flush=True)
            if conflict_file := os.environ.get('KTVIBES_CONFLICT_FILE'):
                Path(conflict_file).write_text(str(preferred), encoding='ascii')
            return
        print(f'KTVIBES_ACTIVE_PORT={app.state.runtime.port}', flush=True)
        if port_file := os.environ.get('KTVIBES_PORT_FILE'):
            Path(port_file).write_text(str(app.state.runtime.port), encoding='ascii')
    if os.environ.get("KTVIBES_OPEN_BROWSER") == "1":
        import threading
        import webbrowser
        threading.Timer(1.5, webbrowser.open, (f"http://127.0.0.1:{app.state.runtime.port}",)).start()
    if missing := worker.missing_tools():
        # Common right after installing: the terminal predates the install and has a stale PATH.
        print(f"WARNING: {', '.join(missing)} not found on PATH. Songs can't be prepared until it is installed.\n"
              "If you just installed it, open a new terminal and run ktvibes again.", flush=True)
    if listener is None:
        uvicorn.run(app, host="0.0.0.0", port=app.state.runtime.port)
    else:
        server = uvicorn.Server(uvicorn.Config(app, host='0.0.0.0', port=app.state.runtime.port))
        try:
            server.run(sockets=[listener])
        finally:
            listener.close()
