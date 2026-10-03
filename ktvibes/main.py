import asyncio
from contextlib import asynccontextmanager, suppress
import io
import json
import os
import shutil
from pathlib import Path
import socket
import math
import qrcode
import qrcode.image.svg
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from .queue import State
from . import lyrics, worker, youtube

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(os.environ.get("KTVIBES_CACHE", ROOT / "cache"))
PORT = int(os.environ.get("KTVIBES_PORT", 8765))
state = State()

@asynccontextmanager
async def lifespan(app):
    CACHE.mkdir(parents=True, exist_ok=True)
    state.restore(CACHE / "queue.json", seed=lambda: {id: meta["prepared"] for id, meta in prepared_songs().items()})
    task = asyncio.create_task(worker.run(state, CACHE))
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

app = FastAPI(title="KTVibes", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

@app.middleware("http")
async def revalidate_static(request, call_next):
    # Pages load plain JS/CSS without a build step; revalidate so edits show up on reload.
    response = await call_next(request)
    if request.url.path.startswith("/static/") or request.url.path in ("/", "/tv"):
        response.headers["Cache-Control"] = "no-cache"
    return response

@app.get("/")
async def remote():
    return FileResponse(ROOT / "static/remote.html")

@app.get("/tv")
async def tv():
    return FileResponse(ROOT / "static/tv.html")

@app.get("/api/state")
async def get_state():
    return state.snapshot()

@app.get("/api/suggest")
async def suggest(q: str = Query(min_length=1, max_length=200)):
    try:
        return await asyncio.to_thread(youtube.suggest, q)
    except Exception:
        return []  # completions are a nicety; never surface their failures

@app.get("/api/search")
async def search(q: str = Query(min_length=1, max_length=200), page: int = Query(0, ge=0, le=9)):
    try:
        results = await asyncio.to_thread(youtube.search, q, page)
    except Exception as exc:
        raise HTTPException(502, f"YouTube search failed: {exc}") from exc
    # Prepared songs start right away; the remote marks them.
    cached = prepared_songs()
    return [{**result, "cached": result["id"] in cached} for result in results]

class Song(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    artist: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=300)

    @field_validator("artist", "title")
    @classmethod
    def nonempty(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Artist and title must not be blank")
        return value

def prepared_songs() -> dict:
    """Cached songs with stems and confirmed details, by video id."""
    songs = {}
    for meta_path in CACHE.glob("*/meta.json"):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            prepared = meta_path.stat().st_mtime
        except (OSError, ValueError):
            continue
        video_id = meta_path.parent.name
        if youtube.ID.fullmatch(video_id) and meta.get("artist") and meta.get("title") and any((meta_path.parent / f"no_vocals.{ext}").is_file() for ext in ("flac", "wav")):
            songs[video_id] = {"id": video_id, "artist": meta["artist"], "title": meta["title"], "duration": meta.get("duration"),
                               "thumbnail": f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg", "prepared": prepared}
    return songs

@app.get("/api/recent")
async def recent(limit: int = Query(20, ge=1, le=50)):
    """Songs that went on stage, most recent first, so the remote can re-queue them without a search."""
    songs = prepared_songs()
    played = sorted((when, video_id) for video_id, when in state.played.items() if video_id in songs)
    return [{k: v for k, v in songs[video_id].items() if k != "prepared"} for _, video_id in reversed(played[-limit:])]

@app.get("/api/ambient")
async def ambient():
    """Cached music videos the TV loops, muted, behind an empty stage."""
    return sorted(path.parent.name for path in CACHE.glob("*/video.mp4") if youtube.ID.fullmatch(path.parent.name))

def song_meta(video_id: str) -> tuple[Path, dict]:
    folder = CACHE / video_id
    if not youtube.ID.fullmatch(video_id) or not (folder / "meta.json").is_file():
        raise HTTPException(404, "Song not found")
    meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    if not meta.get("artist") or not meta.get("title") or not meta.get("duration"):
        raise HTTPException(409, "This song isn't fully prepared yet")
    return folder, meta

async def lyric_versions(meta: dict) -> list[dict]:
    try:
        return await lyrics.candidates(meta["artist"], meta["title"], meta["duration"], (meta.get("source_title") or "",), exhaustive=True)
    except Exception as exc:
        raise HTTPException(502, f"Lyrics lookup failed: {exc}") from exc

@app.get("/api/songs/{video_id}/lyrics")
async def lyric_options(video_id: str):
    """Every LRCLIB version that fits the song, best first, so the remote can pick a language or edition."""
    folder, meta = song_meta(video_id)
    current = (folder / "lyrics.lrc").read_text(encoding="utf-8") if (folder / "lyrics.lrc").is_file() else ""
    options = []
    for c in await lyric_versions(meta):
        raw = c.get("syncedLyrics") or ""
        lines = [line["text"] for line in lyrics.parse_lrc(raw) if line.get("text")]
        options.append({"id": c.get("id"), "track": c.get("trackName"), "artist": c.get("artistName"), "album": c.get("albumName"),
                        "language": lyrics.LANGUAGES[lyrics.script(raw)], "lines": len(lines), "preview": lines[:2], "current": raw == current})
    return options

class LyricChoice(BaseModel):
    id: int

@app.post("/api/songs/{video_id}/lyrics")
async def choose_lyrics(video_id: str, choice: LyricChoice):
    """Save the chosen version; the song on stage switches to it at once."""
    folder, meta = song_meta(video_id)
    chosen = next((c for c in await lyric_versions(meta) if c.get("id") == choice.id), None)
    if not chosen:
        raise HTTPException(404, "That lyrics version is no longer available")
    if state.current and state.current["id"] == video_id:
        # The song on stage switches right away: time the new lines, then resend lyrics to the TV.
        lines = lyrics.parse_lrc(chosen["syncedLyrics"])
        lines = await asyncio.to_thread(worker.timed_lyrics, folder, chosen["syncedLyrics"], folder / "vocals.flac", lines)
        lyrics.line_starts(lines)
        if state.current and state.current["id"] == video_id:
            state.current.update(lyrics=lines, lyrics_rev=state.current.get("lyrics_rev", 0) + 1)
            state.offset = 0
            state.lyrics_sent.clear()
            await state.broadcast()
    (folder / "lyrics.lrc").write_text(chosen["syncedLyrics"], encoding="utf-8")
    meta["lyrics_identity"] = [meta["artist"], meta["title"]]
    meta.pop("lyric_offset", None)  # a nudge for other lyrics no longer fits
    worker.save_meta(folder, meta)
    return {"saved": choice.id}

@app.delete("/api/songs/{video_id}")
async def delete_song(video_id: str):
    """Forget a song and delete its download; queueing it again downloads it fresh."""
    folder = CACHE / video_id
    if not youtube.ID.fullmatch(video_id) or not (folder.is_dir() or video_id in state.played):
        raise HTTPException(404, "Song not found")
    if state.queued(video_id):
        raise HTTPException(409, "Remove it from the queue first")
    state.played.pop(video_id, None)
    if folder.is_symlink():
        folder.unlink()
    elif folder.is_dir():
        await asyncio.to_thread(shutil.rmtree, folder)
    await state.broadcast()
    return {"deleted": video_id}

@app.post("/api/queue", status_code=201)
async def enqueue(song: Song):
    if len(state.upcoming) >= 100:
        raise HTTPException(409, "Queue is full")
    try:
        return await state.add(song.id, song.artist, song.title)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc

@app.get("/media/{video_id}/{filename}")
async def media(video_id: str, filename: str):
    if not youtube.ID.fullmatch(video_id) or filename not in ("vocals.flac", "no_vocals.flac", "video.mp4"):
        raise HTTPException(404)
    path = CACHE / video_id / filename
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, media_type="video/mp4" if filename.endswith(".mp4") else "audio/flac")

def remote_url():
    if os.environ.get("KTVIBES_REMOTE_URL"):
        return os.environ["KTVIBES_REMOTE_URL"].rstrip("/") + "/"
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            host = sock.getsockname()[0]
    except OSError:
        host = "127.0.0.1"
    return f"http://{host}:{PORT}/"

@app.get("/api/config")
async def config():
    return {"remote_url": remote_url()}

@app.get("/api/qr.svg")
async def qr():
    out = io.BytesIO()
    qrcode.make(remote_url(), image_factory=qrcode.image.svg.SvgPathImage).save(out)
    return Response(out.getvalue(), media_type="image/svg+xml")

@app.websocket("/ws")
async def websocket(ws: WebSocket):
    await ws.accept()
    role = ws.query_params.get("role", "remote")
    if role == "tv" and state.player is not None:
        # Newest TV wins: a reload must not be locked out by its own stale socket.
        previous = state.player
        state.disconnect(previous)
        with suppress(Exception):
            await previous.send_json({"type": "error", "message": "Another TV took over playback."})
            await previous.close(code=4001)
    state.clients[ws] = role
    if role == "tv":
        state.player = ws
    await state.broadcast()
    try:
        while True:
            message = await ws.receive_json()
            try:
                if not isinstance(message, dict):
                    raise ValueError("Expected a control object")
                for field in ("value", "delta", "position"):
                    # Text values (guide modes) pass through; State.control converts numbers itself.
                    if isinstance(message.get(field), (int, float)) and not math.isfinite(message[field]):
                        raise ValueError("Expected a finite number")
                await state.control(message, ws)
            except (ValueError, TypeError, KeyError) as exc:
                await ws.send_json({"type": "error", "message": str(exc)})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        state.disconnect(ws)
        await state.broadcast()


def run():
    """`uv run ktvibes`: one process only, since queue state and the model live in memory."""
    import uvicorn
    if missing := worker.missing_tools():
        # Common right after installing: the terminal predates the install and has a stale PATH.
        print(f"WARNING: {', '.join(missing)} not found on PATH. Songs can't be prepared until it is installed.\n"
              "If you just installed it, open a new terminal and run ktvibes again.", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=PORT)
