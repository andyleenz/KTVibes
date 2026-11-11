"""Read prepared song metadata from the existing on-disk cache."""
import json
from pathlib import Path
from fastapi import HTTPException
from . import stems, youtube

class SongLibrary:
    def __init__(self, cache: Path):
        self.cache = cache

    def prepared_songs(self) -> dict:
        """Cached songs with stems and confirmed details, by video id."""
        songs = {}
        for meta_path in self.cache.glob("*/meta.json"):
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                prepared = meta_path.stat().st_mtime
            except (OSError, ValueError):
                continue
            video_id = meta_path.parent.name
            if youtube.ID.fullmatch(video_id) and meta.get("artist") and meta.get("title") and stems.prepared(meta_path.parent):
                songs[video_id] = {"id": video_id, "artist": meta["artist"], "title": meta["title"], "duration": meta.get("duration"),
                                   "thumbnail": f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg", "prepared": prepared, "number": meta.get("number")}
        return songs

    def song_meta(self, video_id: str) -> tuple[Path, dict]:
        folder = self.cache / video_id
        if not youtube.ID.fullmatch(video_id) or not (folder / "meta.json").is_file():
            raise HTTPException(404, "Song not found")
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
        if not meta.get("artist") or not meta.get("title") or not meta.get("duration"):
            raise HTTPException(409, "This song isn't fully prepared yet")
        return folder, meta
