import math
from contextlib import suppress
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from ..schemas import Song

def create_router(runtime):
    router = APIRouter()

    @router.get('/api/state')
    async def get_state():
        return runtime.state.snapshot()

    @router.post('/api/queue', status_code=201)
    async def enqueue(song: Song):
        if len(runtime.state.upcoming) >= 100:
            raise HTTPException(409, "Queue is full")
        try:
            # Search and Recent expose an explicit duplicate-confirmation step.
            return await runtime.state.add(song.id, song.artist, song.title, allow_duplicate=True)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @router.post('/api/queue/next')
    async def enqueue_next(song: Song):
        try:
            return await runtime.state.add_next(song.id, song.artist, song.title)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @router.websocket('/ws')
    async def websocket(ws: WebSocket):
        await ws.accept()
        role = ws.query_params.get("role", "remote")
        if role == "tv" and runtime.state.player is not None:
            # Newest TV wins: a reload must not be locked out by its own stale socket.
            previous = runtime.state.player
            runtime.state.disconnect(previous)
            with suppress(Exception):
                await previous.send_json({"type": "error", "message": "Another device took over playback."})
                await previous.close(code=4001)
        runtime.state.clients[ws] = role
        if role == "tv":
            runtime.state.player = ws
        await runtime.state.broadcast()
        try:
            while True:
                message = await ws.receive_json()
                try:
                    if not isinstance(message, dict):
                        raise ValueError("Expected a control object")
                    for field in ("value", "delta", "position", "minutes"):
                        # Text values (guide modes) pass through; State.control converts numbers itself.
                        if isinstance(message.get(field), (int, float)) and not math.isfinite(message[field]):
                            raise ValueError("Expected a finite number")
                    await runtime.state.control(message, ws)
                except (ValueError, TypeError, KeyError) as exc:
                    await ws.send_json({"type": "error", "message": str(exc)})
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            runtime.state.disconnect(ws)
            await runtime.state.broadcast()

    return router
