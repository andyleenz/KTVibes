import asyncio
import shutil
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from .. import stems, youtube

def create_router(runtime):
    router = APIRouter()

    @router.get('/api/suggest')
    async def suggest(q: str = Query(min_length=1, max_length=200)):
        try:
            return await asyncio.to_thread(youtube.suggest, q)
        except Exception:
            return []  # completions are a nicety; never surface their failures

    @router.get('/api/search')
    async def search(q: str = Query(min_length=1, max_length=200), page: int = Query(0, ge=0, le=9)):
        try:
            results = await asyncio.to_thread(youtube.search, q, page)
        except Exception as exc:
            raise HTTPException(502, f"YouTube search failed: {youtube.explain(exc)}") from exc
        # Prepared songs start right away; the remote marks them.
        cached = runtime.library.prepared_songs()
        return [{**result, "cached": result["id"] in cached} for result in results]

    @router.get('/api/recent')
    async def recent(limit: int = Query(10, ge=1, le=50)):
        """Songs that went on stage, most recent first, so the remote can re-queue them without a search."""
        songs = runtime.library.prepared_songs()
        played = sorted((when, video_id) for video_id, when in runtime.state.played.items() if video_id in songs)
        return [{k: v for k, v in songs[video_id].items() if k != "prepared"} for _, video_id in reversed(played[-limit:])]

    @router.get('/api/songbook')
    async def songbook_list():
        """Prepared songs by songbook number, for the remote's keypad and songbook (with when each was prepared, for 신곡)."""
        return sorted((s for s in runtime.library.prepared_songs().values() if s.get("number")), key=lambda s: s["number"])

    @router.get('/api/ambient')
    async def ambient():
        """Cached music videos the TV loops, muted, behind an empty stage: only songs that were prepared,
        so a video left behind by a failed download never shows up between songs."""
        return sorted(path.parent.name for path in runtime.cache.glob("*/video.mp4") if youtube.ID.fullmatch(path.parent.name) and stems.prepared(path.parent))

    @router.delete('/api/songs/{video_id}')
    async def delete_song(video_id: str):
        """Forget a song and delete its download; queueing it again downloads it fresh."""
        folder = runtime.cache / video_id
        if not youtube.ID.fullmatch(video_id) or not (folder.is_dir() or video_id in runtime.state.played):
            raise HTTPException(404, "Song not found")
        if runtime.state.queued(video_id):
            raise HTTPException(409, "Remove it from the queue first")
        runtime.state.played.pop(video_id, None)
        if folder.is_symlink():
            folder.unlink()
        elif folder.is_dir():
            await asyncio.to_thread(shutil.rmtree, folder)
        await runtime.state.broadcast()
        return {"deleted": video_id}

    @router.get('/media/{video_id}/{filename}')
    async def media(video_id: str, filename: str):
        """Stems are requested by name (vocals, no_vocals) and served in whichever format is cached."""
        if not youtube.ID.fullmatch(video_id) or filename not in (*stems.NAMES, "video.mp4"):
            raise HTTPException(404)
        folder = runtime.cache / video_id
        path = folder / filename if filename == "video.mp4" else stems.path(folder, filename)
        if not path or not path.is_file():
            raise HTTPException(404)
        types = {".mp4": "video/mp4", ".opus": "audio/ogg", ".flac": "audio/flac", ".wav": "audio/wav"}
        return FileResponse(path, media_type=types[path.suffix])

    return router
