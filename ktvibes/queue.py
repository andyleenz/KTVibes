"""All state mutations run on the event loop; queue entries have unique identities."""
import asyncio
import time
import uuid

class State:
    def __init__(self):
        self.current = None
        self.upcoming = []
        self.clients = {}
        self.player = None
        self.playing = True
        self.offset = 0.0
        self.vocal = 0.1
        self.pinyin = True
        self.romanization = True
        self.lyric_scale = 1.0
        self.seek_id = 0
        self.position = 0.0
        self.transition_until = 0.0
        self.wake = asyncio.Event()
        self.revision = 0
        self.broadcast_lock = asyncio.Lock()

    def snapshot(self):
        return {"current": self.current, "upcoming": self.upcoming, "playing": self.playing,
                "offset": self.offset, "vocal": self.vocal, "pinyin": self.pinyin, "romanization": self.romanization, "lyric_scale": self.lyric_scale, "seek_id": self.seek_id, "position": self.position,
                "transition_until": self.transition_until, "server_time": time.time(),
                "player_connected": self.player is not None, "revision": self.revision}

    async def broadcast(self):
        async with self.broadcast_lock:
            self.revision += 1
            message = {"type": "state", **self.snapshot()}
            async def send(ws):
                try:
                    await asyncio.wait_for(ws.send_json(message), timeout=2)
                except Exception:
                    self.clients.pop(ws, None)
                    if self.player is ws:
                        self.player = None
            await asyncio.gather(*(send(ws) for ws in list(self.clients)))

    def advance(self):
        self.current = None
        self.position = 0
        self.offset = 0
        self.transition_until = time.time() + 5
        self.promote()

    def promote(self):
        if self.current is None:
            candidate = next((item for item in self.upcoming if item["status"] != "error"), None)
            if candidate and candidate["status"] == "ready":
                self.upcoming.remove(candidate)
                self.current = candidate
                self.position = 0
                self.offset = 0
                self.transition_until = max(self.transition_until, time.time() + 5)

    async def add(self, video_id, artist, title):
        item = {"key": uuid.uuid4().hex, "id": video_id, "artist": artist, "title": title,
                "status": "queued", "lyrics": [], "duration": 0, "error": None}
        self.upcoming.append(item)
        self.wake.set()
        await self.broadcast()
        return item

    async def control(self, message, sender=None):
        action = message.get("action")
        if action in ("ended", "progress"):
            if sender is not self.player or not self.current or message.get("key") != self.current["key"]:
                return
        if action == "play":
            self.playing = True
        elif action == "pause":
            self.playing = False
        elif action == "skip" or action == "ended":
            self.advance()
        elif action == "offset":
            self.offset = max(-30, min(30, self.offset + float(message.get("delta", 0))))
        elif action == "seek":
            if not self.current:
                raise ValueError("Nothing is playing")
            self.position = max(0, min(float(message["position"]), self.current["duration"]))
            self.seek_id += 1
        elif action == "lyric_scale":
            self.lyric_scale = max(0.6, min(1.8, float(message["value"])))
        elif action == "romanization":
            self.romanization = bool(message.get("value"))
        elif action == "pinyin":
            self.pinyin = bool(message.get("value"))
        elif action == "vocal":
            self.vocal = max(0, min(1, float(message["value"])))
        elif action == "remove":
            self.upcoming = [i for i in self.upcoming if i["key"] != message.get("key")]
        elif action == "reorder":
            keys = message.get("keys", [])
            if len(keys) != len(self.upcoming) or set(keys) != {i["key"] for i in self.upcoming}:
                raise ValueError("Queue changed; try reordering again")
            items = {i["key"]: i for i in self.upcoming}
            self.upcoming = [items[k] for k in keys]
        elif action == "progress":
            self.position = max(0, min(float(message["position"]), self.current["duration"]))
        else:
            raise ValueError("Unknown control")
        self.promote()
        self.wake.set()
        await self.broadcast()
