import asyncio
from contextlib import asynccontextmanager, suppress
import io
import os
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
from . import worker, youtube

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(os.environ.get("KTVIBES_CACHE", ROOT / "cache"))
state = State()

@asynccontextmanager
async def lifespan(app):
    CACHE.mkdir(parents=True, exist_ok=True)
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

@app.get("/api/search")
async def search(q: str = Query(min_length=1, max_length=200)):
    try:
        return await asyncio.to_thread(youtube.search, q)
    except Exception as exc:
        raise HTTPException(502, f"YouTube search failed: {exc}") from exc

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

@app.post("/api/queue", status_code=201)
async def enqueue(song: Song):
    if len(state.upcoming) >= 100:
        raise HTTPException(409, "Queue is full")
    return await state.add(song.id, song.artist, song.title)

@app.get("/media/{video_id}/{filename}")
async def media(video_id: str, filename: str):
    if not youtube.ID.fullmatch(video_id) or filename not in ("vocals.wav", "no_vocals.wav", "video.mp4"):
        raise HTTPException(404)
    path = CACHE / video_id / filename
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, media_type="video/mp4" if filename.endswith(".mp4") else "audio/wav")

def remote_url():
    if os.environ.get("KTVIBES_REMOTE_URL"):
        return os.environ["KTVIBES_REMOTE_URL"].rstrip("/") + "/"
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            host = sock.getsockname()[0]
    except OSError:
        host = "127.0.0.1"
    return f"http://{host}:8765/"

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
        previous, state.player = state.player, None
        state.clients.pop(previous, None)
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
                    if field in message and not math.isfinite(float(message[field])):
                        raise ValueError("Expected a finite number")
                await state.control(message, ws)
            except (ValueError, TypeError, KeyError) as exc:
                await ws.send_json({"type": "error", "message": str(exc)})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        state.clients.pop(ws, None)
        if state.player is ws:
            state.player = None
        await state.broadcast()
