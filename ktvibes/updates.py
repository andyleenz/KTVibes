"""Version metadata and background GitHub release checks."""
import asyncio
import re
import tomllib
from pathlib import Path

GITHUB_RELEASE_API = "https://api.github.com/repos/JeffShih-wiwynn/KTVibes/releases/latest"
UPDATE_CHECK_INTERVAL = 24 * 60 * 60
UPDATE_CHECK_TIMEOUT = 8

def project_version(root: Path = Path(__file__).resolve().parent.parent) -> str:
    with (root / "pyproject.toml").open("rb") as project_file:
        return tomllib.load(project_file)["project"]["version"]

def version_key(value: str) -> tuple[int, ...] | None:
    match = re.fullmatch(r"v?(\d+(?:\.\d+){1,3})", value.strip())
    return tuple(int(part) for part in match.group(1).split(".")) if match else None

def newer_release(current: str, release: dict) -> dict | None:
    if not isinstance(release, dict) or release.get("draft") or release.get("prerelease"):
        return None
    latest = str(release.get("tag_name", ""))
    url = str(release.get("html_url", ""))
    current_key, latest_key = version_key(current), version_key(latest)
    expected_url = f"https://github.com/JeffShih-wiwynn/KTVibes/releases/tag/{latest}"
    if current_key and latest_key and latest_key > current_key and url == expected_url:
        return {"version": latest, "url": url}
    return None

class ReleaseUpdates:
    def __init__(self, root: Path):
        self.root = root
        self.info: dict | None = None
        self.check_complete = False

    async def run(self) -> None:
        """Refresh the update notice without delaying KTVibes startup."""
        import httpx

        current = project_version(self.root)
        while True:
            retry_after = UPDATE_CHECK_INTERVAL
            try:
                async with httpx.AsyncClient(timeout=UPDATE_CHECK_TIMEOUT, follow_redirects=True) as client:
                    response = await client.get(GITHUB_RELEASE_API, headers={"Accept": "application/vnd.github+json", "User-Agent": "KTVibes"})
                    response.raise_for_status()
                    release = response.json()
                self.info = newer_release(current, release)
                self.check_complete = True
            except (httpx.HTTPError, ValueError, TypeError, KeyError):
                self.info = None
                self.check_complete = True
                retry_after = 60 * 60
            await asyncio.sleep(retry_after)
