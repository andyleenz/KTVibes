"""All state mutations run on the event loop; queue entries have unique identities."""
import asyncio
import json
import math
from pathlib import Path
import time
import uuid

DISPLAY = {"video_mode": ("show", "blur", "hide"), "lyric_mode": ("scroll", "two", "off")}
GUIDES = ("off", "latin", "jyutping", "hangul")
HISTORY = 200  # remembered plays, for the remote's "Recent" list
UNDO_SECONDS = 15  # how long a removal can be taken back
SAVE_EVERY = 10  # seconds between queue.json writes for position reports alone
BREATHER = 4  # seconds between one song ending and the next starting

def number(value) -> float:
    """Control values arrive as JSON; reject text and NaN/inf before clamping."""
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("Expected a finite number")
    return result


class State:
    def __init__(self):
        self.current = None
        self.upcoming = []
        self.clients = {}
        self.player = None
        self.playing = True
        self.offset = 0.0
        self.vocal = 0.1
        self.music = 1.0  # instrumental (backing track) volume
        self.guide = "latin"  # off | latin | hangul, shown above the lyrics
        self.lyric_scale = 1.0
        self.video_mode = "show"  # show | blur | hide: blur suits lyric videos, whose own lyrics clash
        self.lyric_mode = "scroll"  # scroll | two (classic two-line KTV) | off
        self.speed = 1.0  # playback tempo, 0.5-1.5; pitch is kept
        self.key = 0  # pitch shift in semitones, -6..+6
        self.seek_id = 0
        self.position = 0.0
        self.transition_until = 0.0
        self.wake = asyncio.Event()
        self.revision = 0
        self.broadcast_lock = asyncio.Lock()
        self.path = None  # queue.json; set by restore() so the queue survives restarts
        self.played = {}  # video id -> unix time the song last went on stage
        self.audio = False  # the TV has enabled sound, so playback can actually start
        self.undo = None  # the last removal, for the remote's Undo
        self.saved_at = 0.0
        self.lyrics_sent = {}  # TV socket -> key of the song whose lyrics it already has

    def guides(self):
        """Guide modes with something to show for the current song (all of them when idle)."""
        units = [u for line in (self.current or {}).get("lyrics", []) for u in line.get("units") or []]
        if not self.current:
            return list(GUIDES)
        return ["off"] + [mode for index, mode in ((3, "latin"), (5, "jyutping"), (4, "hangul")) if any(len(u) > index and u[index] for u in units)]

    def snapshot(self, lyrics=True):
        """Lyrics are large and only the TV draws them, so broadcasts leave them out (see broadcast)."""
        brief = lambda item: item if lyrics or item is None else {k: v for k, v in item.items() if k != "lyrics"}
        return {"current": brief(self.current), "upcoming": [brief(i) for i in self.upcoming], "playing": self.playing,
                "offset": self.offset, "vocal": self.vocal, "music": self.music, "guide": self.guide, "guides": self.guides(), "lyric_scale": self.lyric_scale, "video_mode": self.video_mode, "lyric_mode": self.lyric_mode, "speed": self.speed, "key": self.key, "seek_id": self.seek_id, "position": self.position,
                "transition_until": self.transition_until, "server_time": time.time(),
                "player_connected": self.player is not None, "player_audio": self.player is not None and self.audio,
                "undo": self.undo and {"title": self.undo["item"]["title"], "until": self.undo["until"]},
                "revision": self.revision}

    def restore(self, path: Path, seed=lambda: {}):
        """Reload the saved queue; songs are prepared again (fast from cache) and the current one resumes."""
        self.path = path
        try:
            saved = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            saved = {}
        # Before play history existed, fall back to whatever seed() knows (e.g. cache timestamps).
        self.played = saved["played"] if isinstance(saved.get("played"), dict) else seed()
        entries = saved.get("upcoming", [])
        if saved.get("current"):
            entries = [saved["current"], *entries]
        for entry in entries:
            item = self.entry(entry["id"], entry["artist"], entry["title"])
            if entry is saved.get("current"):
                item["resume"] = float(entry.get("position") or 0)
            self.upcoming.append(item)
        self.wake.set()

    def save(self):
        if self.path is None:
            return
        brief = lambda i: {"id": i["id"], "artist": i["artist"], "title": i["title"]}
        data = {"current": self.current and {**brief(self.current), "position": self.position},
                "upcoming": [brief(i) for i in self.upcoming if i["status"] != "error"], "played": self.played}
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self.path)

    async def broadcast(self, persist=True):
        async with self.broadcast_lock:
            self.revision += 1
            if persist:
                try:
                    self.save()
                    self.saved_at = time.monotonic()
                except OSError:
                    pass  # a full disk should not stop the party
            message = {"type": "state", **self.snapshot(lyrics=False)}
            key = self.current and self.current["key"]
            async def send(ws):
                # A TV gets the current song's lyrics once per song (and again after reconnecting).
                out = message
                if key and self.clients.get(ws) == "tv" and self.lyrics_sent.get(ws) != key:
                    out = {**message, "current": {**message["current"], "lyrics": self.current["lyrics"]}}
                try:
                    await asyncio.wait_for(ws.send_json(out), timeout=2)
                    self.lyrics_sent[ws] = key
                except Exception:
                    self.disconnect(ws)
            await asyncio.gather(*(send(ws) for ws in list(self.clients)))

    def disconnect(self, ws):
        self.clients.pop(ws, None)
        self.lyrics_sent.pop(ws, None)
        if self.player is ws:
            self.player = None
            self.audio = False

    def advance(self):
        self.current = None
        self.position = 0
        self.offset = 0
        # Tempo and key suit one singer and one song, so each song starts as recorded.
        self.speed = 1.0
        self.key = 0
        # A short breather between songs shows who's up next; a song on an empty stage starts at once.
        self.transition_until = time.time() + BREATHER
        self.promote()

    def promote(self):
        if self.current is None:
            candidate = next((item for item in self.upcoming if item["status"] != "error"), None)
            if candidate and candidate["status"] == "ready":
                self.upcoming.remove(candidate)
                self.current = candidate
                self.position = candidate.pop("resume", 0)
                self.played[candidate["id"]] = time.time()
                if len(self.played) > HISTORY:
                    self.played = dict(sorted(self.played.items(), key=lambda p: p[1])[-HISTORY:])
                self.offset = candidate.get("offset", 0)
                # Cantopop reads in jyutping, Mandarin in pinyin: follow the song when on either.
                if self.guide in ("latin", "jyutping"):
                    from .lyrics import cantonese
                    self.guide = "jyutping" if cantonese(candidate.get("lyrics") or []) and "jyutping" in self.guides() else "latin"

    @staticmethod
    def entry(video_id, artist, title):
        return {"key": uuid.uuid4().hex, "id": video_id, "artist": artist, "title": title,
                "status": "queued", "lyrics": [], "duration": 0, "error": None}

    def remember_offset(self):
        """Keep the lyric timing nudge in the song's meta.json, so it applies next time too."""
        if self.path is None or not self.current:
            return
        self.current["offset"] = self.offset
        meta_path = self.path.parent / self.current["id"] / "meta.json"
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            meta["lyric_offset"] = self.offset
            temporary = meta_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            temporary.replace(meta_path)
        except (OSError, ValueError):
            pass

    def take_back(self):
        """Put the last removed song back where it was, while the removal is still recent."""
        undo, self.undo = self.undo, None
        if not undo or time.time() > undo["until"]:
            raise ValueError("Nothing to undo")
        if self.queued(undo["item"]["id"]):
            raise ValueError("That song is already in the queue")
        self.upcoming.insert(min(undo["index"], len(self.upcoming)), undo["item"])

    def queued(self, video_id):
        return any(i and i["id"] == video_id and i["status"] != "error" for i in (self.current, *self.upcoming))

    async def add(self, video_id, artist, title):
        if self.queued(video_id):
            raise ValueError("That song is already in the queue")
        item = self.entry(video_id, artist, title)
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
        elif action == "undo":
            self.take_back()
        elif action == "audio":
            if sender is not self.player:
                return
            self.audio = message.get("value") is True
        elif action == "offset":
            self.offset = max(-30, min(30, self.offset + number(message.get("delta", 0))))
            self.remember_offset()
        elif action == "seek":
            if not self.current:
                raise ValueError("Nothing is playing")
            self.position = max(0, min(number(message["position"]), self.current["duration"]))
            self.seek_id += 1
        elif action == "lyric_scale":
            self.lyric_scale = max(0.6, min(1.8, number(message["value"])))
        elif action in DISPLAY:
            options = DISPLAY[action]
            value = message.get("value")
            if value == "cycle":
                value = options[(options.index(getattr(self, action)) + 1) % len(options)]
            if value not in options:
                raise ValueError(f"Unknown {action.replace('_', ' ')}")
            setattr(self, action, value)
        elif action == "speed":
            self.speed = round(max(0.5, min(1.5, number(message["value"]))), 2)
        elif action == "key":
            self.key = int(max(-6, min(6, round(number(message["value"])))))
        elif action == "guide":
            modes = self.guides()
            if message.get("value") == "cycle":
                # From a mode this song lacks, jump to its first visible guide rather than "off".
                self.guide = modes[(modes.index(self.guide) + 1) % len(modes)] if self.guide in modes else modes[min(1, len(modes) - 1)]
            elif message.get("value") in GUIDES:
                self.guide = message["value"]
            else:
                raise ValueError("Unknown guide")
        elif action == "music":
            self.music = max(0, min(1, number(message["value"])))
        elif action == "vocal":
            self.vocal = max(0, min(1, number(message["value"])))
        elif action == "remove":
            index = next((n for n, i in enumerate(self.upcoming) if i["key"] == message.get("key")), None)
            if index is not None:
                self.undo = {"item": self.upcoming.pop(index), "index": index, "until": time.time() + UNDO_SECONDS}
        elif action == "retry":
            item = next((i for i in self.upcoming if i["key"] == message.get("key") and i["status"] == "error"), None)
            if item is None:
                return
            if self.queued(item["id"]):
                raise ValueError("That song is already in the queue")
            item.update(status="queued", error=None, step=None, progress=None)
        elif action == "reorder":
            keys = message.get("keys", [])
            if len(keys) != len(self.upcoming) or set(keys) != {i["key"] for i in self.upcoming}:
                raise ValueError("Queue changed; try reordering again")
            items = {i["key"]: i for i in self.upcoming}
            self.upcoming = [items[k] for k in keys]
        elif action == "progress":
            self.position = max(0, min(number(message["position"]), self.current["duration"]))
        else:
            raise ValueError("Unknown control")
        self.promote()
        self.wake.set()
        # Position reports arrive every two seconds; saving them occasionally is enough to resume after a restart.
        await self.broadcast(persist=action != "progress" or time.monotonic() - self.saved_at >= SAVE_EVERY)
