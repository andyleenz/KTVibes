"""Resources owned by a single KTVibes application."""
import os
import socket
from dataclasses import dataclass, field
from pathlib import Path
from .queue import State
from .library import SongLibrary
from .lyric_service import LyricsService
from .updates import ReleaseUpdates, project_version
from .identities import IdentityStore

PROJECT_ROOT = Path(__file__).resolve().parent.parent

@dataclass
class Runtime:
    root: Path = PROJECT_ROOT
    cache: Path = field(default_factory=lambda: Path(os.environ.get('KTVIBES_CACHE', PROJECT_ROOT / 'cache')))
    port: int = field(default_factory=lambda: int(os.environ.get('KTVIBES_PORT', 8765)))
    state: State = field(default_factory=State)
    library: SongLibrary = field(init=False)
    lyrics: LyricsService = field(init=False)
    updates: ReleaseUpdates = field(init=False)
    identities: IdentityStore = field(init=False)

    def __post_init__(self):
        self.library = SongLibrary(self.cache)
        self.lyrics = LyricsService(self.state, self.library)
        self.updates = ReleaseUpdates(self.root)
        self.identities = IdentityStore(self.cache / 'identities.json')

    def project_version(self):
        return project_version(self.root)

    def build(self) -> str:
        """Fingerprint of the files the pages load. A TV left open across an update reloads itself
        instead of running old code against the new server."""
        import hashlib
        digest = hashlib.sha256()
        for path in sorted((self.root / "static").rglob("*")):
            if path.is_file():
                digest.update(path.name.encode() + path.read_bytes())
        return digest.hexdigest()[:12]

    def remote_url(self):
        if os.environ.get("KTVIBES_REMOTE_URL"):
            url = os.environ["KTVIBES_REMOTE_URL"].rstrip("/")
            return url if url.endswith("/remote") else url + "/remote"
        try:
            if host := os.environ.get('KTVIBES_ADVERTISE_IP'):
                return f"http://{host}:{self.port}/remote"
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.connect(("8.8.8.8", 80))
                host = sock.getsockname()[0]
        except OSError:
            host = "127.0.0.1"
        return f"http://{host}:{self.port}/remote"
