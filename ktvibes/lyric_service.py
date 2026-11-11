"""Lyrics viewing and selection, sharing the playback state's cache locks.

One service belongs to one application. Lookup deduplication and selection races
are local to that instance; cache filenames and response shapes stay unchanged.
"""
import asyncio
from contextlib import suppress
import json
import os
import time
import uuid
from pathlib import Path
from fastapi import HTTPException
from . import lyrics, stems, worker, youtube
from .schemas import LyricChoice, OffsetChoice

PLAIN_ERROR_COOLDOWN = 30

def _plain_identity(artist: str, title: str) -> list[str]:
    return [lyrics.plain_identity(artist), lyrics.plain_identity(title)]


def _plain_cache_write(path: Path, value: dict) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, path)
    finally:
        with suppress(OSError):
            temporary.unlink()


def _save_viewer_selection(folder: Path, identity: list[str], fmt: str, record_id: int | None) -> None:
    _plain_cache_write(folder / "viewer_selection.json", {
        "identity": identity, "format": fmt, "record_id": record_id, "origin": "manual"})


def _cached_synced(folder: Path, target: dict) -> str:
    path = folder / "lyrics.lrc"
    if not path.is_file():
        return ""
    try:
        raw = path.read_text(encoding="utf-8")
        meta_path = folder / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}
    except (OSError, ValueError):
        return ""
    saved = meta.get("lyrics_identity")
    if isinstance(saved, (list, tuple)) and len(saved) >= 2 and _plain_identity(str(saved[0]), str(saved[1])) != _plain_identity(str(target.get("artist") or ""), str(target.get("title") or "")):
        return ""
    return raw if lyrics.STAMP.search(raw) and lyrics.lrc_display_text(raw).strip() else ""


def _plain_cache_read(path: Path, identity: list[str], now: float) -> dict | None:
    return lyrics.read_plain_cache(path, identity, now)


def _viewer_result(target: dict, status: str, source: str | None = None, text: str = "", record_id=None) -> dict:
    return {"key": target["key"], "id": target["id"], "artist": target.get("artist", ""), "title": target.get("title", ""),
            "status": status, "source": source, "text": text, "record_id": record_id}


class LyricsService:
    def __init__(self, state, library):
        self.state = state
        self.library = library
        self.cache = library.cache
        self.lookups: dict[tuple[str, str], asyncio.Task] = {}
        self.errors: dict[tuple[str, str], float] = {}
        self.selection_seq: dict[str, int] = {}

    async def close(self):
        tasks = list(self.lookups.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.lookups.clear()

    def _viewer_target(self, key: str):
        target = self.state.current if self.state.current and self.state.current.get("key") == key else next(
            (item for item in self.state.upcoming if item.get("key") == key), None)
        if target is None:
            raise HTTPException(404, "Lyrics target is no longer available")
        if not youtube.ID.fullmatch(target.get("id") or ""):
            raise HTTPException(404, "Song not found")
        return target

    def _publish_viewer_lyrics_source(self, target: dict, source: str) -> None:
        """Keep Queue snapshots informed without sending lyric text or blocking cache locks."""
        if target.get("viewer_lyrics_source") == source:
            return
        target["viewer_lyrics_source"] = source
        asyncio.get_running_loop().create_task(self.state.broadcast(persist=False))

    async def lyrics_view(self, target_key: str):
        """Read cached synced lyrics or an independently cached LRCLIB plain-lyrics fallback."""
        target = self._viewer_target(target_key)
        video_id = target["id"]
        folder = self.cache / video_id
        identity = _plain_identity(target.get("artist", ""), target.get("title", ""))
        lookup_key = (video_id, json.dumps(identity, ensure_ascii=False))
        plain_path = folder / "plain_lyrics.json"
        duration = target.get("duration")
        async with self.state.cache_lock(video_id):
            folder.mkdir(parents=True, exist_ok=True)
            selection = lyrics.read_viewer_selection(folder / "viewer_selection.json", identity)
            raw = _cached_synced(folder, target)
            cached = _plain_cache_read(plain_path, identity, time.time())
            if selection and selection["format"] == "plain" and cached and cached.get("status") == "ready" and cached.get("record_id") == selection["record_id"]:
                self._publish_viewer_lyrics_source(target, "plain")
                return _viewer_result(target, "ready", "plain", cached["text"], cached.get("record_id"))
            if selection and selection["format"] == "none":
                self._publish_viewer_lyrics_source(target, "missing")
                return _viewer_result(target, "missing")
            if selection and selection["format"] == "synced" and raw:
                self._publish_viewer_lyrics_source(target, "synced")
                return _viewer_result(target, "ready", "synced", lyrics.lrc_display_text(raw), selection["record_id"])
            if selection:
                self._publish_viewer_lyrics_source(target, "missing")
                return _viewer_result(target, "missing")
            if raw:
                self._publish_viewer_lyrics_source(target, "synced")
                return _viewer_result(target, "ready", "synced", lyrics.lrc_display_text(raw))
            if cached:
                if cached["status"] == "ready":
                    self._publish_viewer_lyrics_source(target, "plain")
                    return _viewer_result(target, "ready", "plain", cached["text"], cached.get("record_id"))
                self._publish_viewer_lyrics_source(target, "missing")
                return _viewer_result(target, "missing")
            if time.time() - self.errors.get(lookup_key, 0) < PLAIN_ERROR_COOLDOWN:
                self._publish_viewer_lyrics_source(target, "error")
                return _viewer_result(target, "error")
            self._publish_viewer_lyrics_source(target, "processing")
            if not duration:
                try:
                    duration = json.loads((folder / "meta.json").read_text(encoding="utf-8")).get("duration")
                except (OSError, ValueError):
                    duration = None

        task = self.lookups.get(lookup_key)
        if task is None or task.done():
            task = asyncio.create_task(lyrics.plain_record(target.get("artist", ""), target.get("title", ""), duration))
            self.lookups[lookup_key] = task
            task.add_done_callback(lambda done, key=lookup_key: self.lookups.pop(key, None) if self.lookups.get(key) is done else None)
        try:
            record = await asyncio.wait_for(asyncio.shield(task), timeout=45)
        except Exception:
            self.errors[lookup_key] = time.time()
            if self.lookups.get(lookup_key) is task:
                self.lookups.pop(lookup_key, None)
            self._publish_viewer_lyrics_source(target, "error")
            return _viewer_result(target, "error")
        if self.lookups.get(lookup_key) is task:
            self.lookups.pop(lookup_key, None)

        current_target = self._viewer_target(target_key)
        if current_target.get("id") != video_id or _plain_identity(current_target.get("artist", ""), current_target.get("title", "")) != identity:
            raise HTTPException(409, "Lyrics target changed; please reopen the viewer")
        async with self.state.cache_lock(video_id):
            selection = lyrics.read_viewer_selection(folder / "viewer_selection.json", identity)
            raw = _cached_synced(folder, current_target)
            cached = _plain_cache_read(plain_path, identity, time.time())
            if selection and selection["format"] == "plain" and cached and cached.get("status") == "ready" and cached.get("record_id") == selection["record_id"]:
                self._publish_viewer_lyrics_source(current_target, "plain")
                return _viewer_result(current_target, "ready", "plain", cached["text"], cached.get("record_id"))
            if selection and selection["format"] == "none":
                self._publish_viewer_lyrics_source(current_target, "missing")
                return _viewer_result(current_target, "missing")
            if selection and selection["format"] == "synced" and raw:
                self._publish_viewer_lyrics_source(current_target, "synced")
                return _viewer_result(current_target, "ready", "synced", lyrics.lrc_display_text(raw), selection["record_id"])
            if selection:
                self._publish_viewer_lyrics_source(current_target, "missing")
                return _viewer_result(current_target, "missing")
            if raw:
                self._publish_viewer_lyrics_source(current_target, "synced")
                return _viewer_result(current_target, "ready", "synced", lyrics.lrc_display_text(raw))
            # Another request may have committed a result while this request awaited LRCLIB.
            cached = _plain_cache_read(plain_path, identity, time.time())
            if cached:
                if cached["status"] == "ready":
                    self._publish_viewer_lyrics_source(current_target, "plain")
                    return _viewer_result(current_target, "ready", "plain", cached["text"], cached.get("record_id"))
                self._publish_viewer_lyrics_source(current_target, "missing")
                return _viewer_result(current_target, "missing")
            if record is None:
                _plain_cache_write(plain_path, {"identity": identity, "record_id": None, "status": "missing", "checked_at": time.time(), "text": ""})
                self._publish_viewer_lyrics_source(current_target, "missing")
                return _viewer_result(current_target, "missing")
            text = record.get("text") if isinstance(record, dict) else None
            if not isinstance(text, str) or not text.strip() or len(text.encode("utf-8")) > 200_000:
                self._publish_viewer_lyrics_source(current_target, "error")
                return _viewer_result(current_target, "missing")
            value = {"identity": identity, "record_id": record.get("id"), "status": "ready", "checked_at": time.time(), "text": text.strip()}
            _plain_cache_write(plain_path, value)
            self._publish_viewer_lyrics_source(current_target, "plain")
            return _viewer_result(current_target, "ready", "plain", value["text"], value["record_id"])

    async def lyric_options(self, video_id: str, q: str):
        """Every LRCLIB version that fits the song, best first, so the remote can pick a language or edition.
        With `q`, a free-text search instead, for songs the automatic lookup missed or got wrong."""
        folder, meta = self.library.song_meta(video_id)
        current = (folder / "lyrics.lrc").read_text(encoding="utf-8") if (folder / "lyrics.lrc").is_file() else ""
        try:
            found = await (lyrics.search(q.strip(), meta["duration"]) if q.strip() else
                           lyrics.candidates(meta["artist"], meta["title"], meta["duration"], (meta.get("source_title") or "",), exhaustive=True))
        except Exception as exc:
            raise HTTPException(502, f"Lyrics lookup failed: {exc}") from exc
        saved_id = meta.get("lyrics_record_id") if "lyrics_record_id" in meta else None
        has_saved_id = "lyrics_record_id" in meta and saved_id is not None
        matched_content = False
        options = []
        for c in found:
            raw = c.get("syncedLyrics") or ""
            lines = [line["text"] for line in lyrics.parse_lrc(raw) if line.get("text")]
            if has_saved_id:
                selected = c.get("id") == saved_id
            else:
                selected = not matched_content and raw == current
                matched_content = matched_content or selected
            options.append({"id": c.get("id"), "track": c.get("trackName"), "artist": c.get("artistName"), "album": c.get("albumName"),
                            "language": lyrics.LANGUAGES[lyrics.script(raw)], "lines": len(lines), "preview": lines[:2], "current": selected,
                            # seconds longer (+) or shorter than this song: a big gap usually means another version
                            "difference": round(float(c.get("duration") or 0) - meta["duration"])})
        return options

    async def lyric_choices(self, target_key: str, q: str):
        """Mixed-format manual search; the legacy song lyrics endpoint remains synced-only."""
        target = self._viewer_target(target_key)
        video_id = target["id"]
        folder = self.cache / video_id
        identity = _plain_identity(target.get("artist", ""), target.get("title", ""))
        duration = target.get("duration")
        synced_raw = ""
        plain = None
        saved_id = None
        has_saved_id = False
        selection = None
        async with self.state.cache_lock(video_id):
            if folder.exists():
                synced_raw = _cached_synced(folder, target)
                plain = _plain_cache_read(folder / "plain_lyrics.json", identity, time.time())
                selection = lyrics.read_viewer_selection(folder / "viewer_selection.json", identity)
                try:
                    meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
                    saved_id = meta.get("lyrics_record_id")
                    has_saved_id = saved_id is not None and "lyrics_record_id" in meta
                    duration = duration or meta.get("duration")
                except (OSError, ValueError):
                    pass
        try:
            found = await lyrics.mixed_search(q.strip(), target.get("artist", ""), target.get("title", ""), duration)
        except Exception as exc:
            upstream = getattr(exc, "response", None)
            status = getattr(upstream, "status_code", None)
            if status == 503:
                raise HTTPException(503, "LRCLIB is temporarily busy. Please wait 1 second, then try again.",
                                    headers={"Retry-After": "1"}) from exc
            if status == 429:
                retry_after = getattr(upstream, "headers", {}).get("Retry-After", "")
                try:
                    retry_after = str(max(1, min(60, int(float(retry_after)))))
                except (TypeError, ValueError):
                    retry_after = "5"
                raise HTTPException(429, f"LRCLIB is limiting lyric searches. Please wait {retry_after} seconds, then try again.",
                                    headers={"Retry-After": retry_after}) from exc
            raise HTTPException(502, f"Lyrics lookup failed: {exc}") from exc
        results = []
        legacy_matched = False
        for candidate in found:
            raw = candidate.get("syncedLyrics") or ""
            synced_available = bool(lyrics.STAMP.search(raw))
            synced_lines = [line["text"] for line in lyrics.parse_lrc(raw) if line.get("text")] if synced_available else []
            if selection and selection["format"] == "synced":
                synced_current = synced_available and candidate.get("id") == selection["record_id"]
            elif selection and selection["format"] in ("plain", "none"):
                synced_current = False
            elif has_saved_id:
                synced_current = synced_available and candidate.get("id") == saved_id
            else:
                synced_current = synced_available and not legacy_matched and raw == synced_raw and bool(synced_raw)
                legacy_matched = legacy_matched or synced_current
            plain_text = lyrics.valid_plain_text(candidate)
            plain_available = plain_text is not None
            plain_selected = bool(plain and plain.get("status") == "ready" and candidate.get("id") == plain.get("record_id"))
            plain_active = bool(selection and selection["format"] == "plain" and plain_selected)
            try:
                difference = round(float(candidate.get("duration") or 0) - float(duration)) if duration else None
            except (TypeError, ValueError):
                difference = None
            results.append({
                "id": candidate.get("id"), "track": candidate.get("trackName"), "artist": candidate.get("artistName"),
                "album": candidate.get("albumName"), "difference": difference,
                "formats": {
                    "synced": {"available": synced_available, "current": synced_current,
                               "language": lyrics.LANGUAGES[lyrics.script(raw)] if synced_available else None,
                               "lines": len(synced_lines), "preview": synced_lines[:2]},
                    "plain": {"available": plain_available, "selected": plain_selected,
                              "active": plain_active,
                              "preview": (plain_text.splitlines()[:2] if plain_available else []),
                              "lines": len(plain_text.splitlines()) if plain_available else 0}
                }
            })
        return {"key": target_key, "id": video_id,
                "synced_active": bool(synced_raw) and not (selection and selection["format"] in ("plain", "none")),
                "selection_format": selection.get("format") if selection else None,
                "plain_record_id": plain.get("record_id") if plain and plain.get("status") == "ready" else None,
                "plain_origin": plain.get("origin") if plain and plain.get("status") == "ready" else None,
                "results": results}

    async def mark_lyrics_unavailable(self, target_key: str):
        """Remember that no currently suitable lyrics should be shown for this song."""
        target = self._viewer_target(target_key)
        video_id = target["id"]
        identity = _plain_identity(target.get("artist", ""), target.get("title", ""))
        folder = self.cache / video_id
        self.selection_seq[target_key] = self.selection_seq.get(target_key, 0) + 1
        async with self.state.cache_lock(video_id):
            target = self._viewer_target(target_key)
            if target["id"] != video_id or _plain_identity(target.get("artist", ""), target.get("title", "")) != identity:
                raise HTTPException(409, "Lyrics target changed while saving")
            folder.mkdir(parents=True, exist_ok=True)
            _save_viewer_selection(folder, identity, "none", None)
            target.update(lyrics=[], lyrics_status="missing", viewer_lyrics_source="missing")
            if target is self.state.current:
                target["lyrics_rev"] = target.get("lyrics_rev", 0) + 1
                self.state.lyrics_sent.clear()
            await self.state.broadcast()
        return {"saved": True, "status": "missing", "source": "none"}

    async def choose_plain_lyrics(self, target_key: str, choice: LyricChoice):
        """Persist a Viewer-only fallback without touching synced lyrics or playback state."""
        target = self._viewer_target(target_key)
        video_id = target["id"]
        identity = _plain_identity(target.get("artist", ""), target.get("title", ""))
        folder = self.cache / video_id
        request_seq = self.selection_seq.get(target_key, 0) + 1
        self.selection_seq[target_key] = request_seq
        try:
            chosen = await lyrics.record(choice.id)
        except Exception as exc:
            raise HTTPException(502, f"Lyrics lookup failed: {exc}") from exc
        if not isinstance(chosen, dict) or chosen.get("id") != choice.id:
            raise HTTPException(404, "That lyrics version is no longer available")
        text = lyrics.valid_plain_text(chosen)
        if text is None:
            raise HTTPException(422, "That lyrics version has no usable plain lyrics")
        # Re-resolve after the network call: promotion with the same key is safe; removal or a
        # different current song is not. Latest request started for this target wins the race.
        current_target = self._viewer_target(target_key)
        if current_target.get("id") != video_id or _plain_identity(current_target.get("artist", ""), current_target.get("title", "")) != identity:
            raise HTTPException(409, "Lyrics target changed while saving")
        if self.selection_seq.get(target_key) != request_seq:
            raise HTTPException(409, "A newer lyrics selection is being saved")
        async with self.state.cache_lock(video_id):
            current_target = self._viewer_target(target_key)
            if current_target.get("id") != video_id or _plain_identity(current_target.get("artist", ""), current_target.get("title", "")) != identity:
                raise HTTPException(409, "Lyrics target changed while saving")
            if self.selection_seq.get(target_key) != request_seq:
                raise HTTPException(409, "A newer lyrics selection is being saved")
            folder.mkdir(parents=True, exist_ok=True)
            value = {"identity": identity, "record_id": choice.id, "status": "ready", "checked_at": time.time(),
                     "text": text.strip(), "origin": "manual"}
            _plain_cache_write(folder / "plain_lyrics.json", value)
            _save_viewer_selection(folder, identity, "plain", choice.id)
            self._publish_viewer_lyrics_source(current_target, "plain")
            return {"saved": choice.id, "status": "ready", "source": "plain", "active": True, "text": value["text"]}

    def queue_item(self, queue_key: str, video_id: str | None = None):
        item = next((i for i in self.state.upcoming if i["key"] == queue_key), None)
        if item is None:
            raise HTTPException(404, "Queue song not found")
        if video_id is not None and item["id"] != video_id:
            raise HTTPException(409, "Queue song changed")
        if item["status"] != "ready":
            raise HTTPException(409, "Lyrics settings are not ready yet")
        return item

    async def select_lyrics(self, video_id: str, choice: LyricChoice, target=None):
        """Save and prepare a selected LRCLIB record for current or queued playback."""
        folder, _ = self.library.song_meta(video_id)
        try:
            chosen = await lyrics.record(choice.id)
        except Exception as exc:
            raise HTTPException(502, f"Lyrics lookup failed: {exc}") from exc
        raw = (chosen or {}).get("syncedLyrics") or ""
        if not chosen or not lyrics.STAMP.search(raw):
            raise HTTPException(404, "That lyrics version is no longer available")
        if target is not None and (target not in self.state.upcoming or target["status"] != "ready"):
            raise HTTPException(409, "Queue song changed while saving")

        async with self.state.cache_lock(video_id):
            meta_path = folder / "meta.json"
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                raise HTTPException(409, "Song cache changed; try again") from exc
            old_raw = (folder / "lyrics.lrc").read_text(encoding="utf-8") if (folder / "lyrics.lrc").is_file() else ""
            changed = raw != old_raw
            if changed:
                worker.save_lyrics(folder, raw)
                meta.pop("lyric_offset", None)
                meta["lyrics_revision"] = int(meta.get("lyrics_revision") or 0) + 1
            meta["lyrics_record_id"] = choice.id
            meta["lyrics_identity"] = [meta["artist"], meta["title"]]
            meta["lyrics_source"] = "manual"
            worker.save_meta(folder, meta)
            revision = int(meta.get("lyrics_revision") or 0)

        lines = lyrics.parse_lrc(raw)
        vocals_path = stems.path(folder, "vocals")
        if changed and vocals_path and vocals_path.is_file():
            try:
                lines = await asyncio.to_thread(worker.timed_lyrics, folder, raw, vocals_path, lines)
            except Exception as exc:
                raise HTTPException(502, "Lyrics timing failed") from exc
        lyrics.line_starts(lines)

        async with self.state.cache_lock(video_id):
            latest = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
            current_raw = (folder / "lyrics.lrc").read_text(encoding="utf-8") if (folder / "lyrics.lrc").is_file() else ""
            if current_raw != raw or int(latest.get("lyrics_revision") or 0) != revision:
                raise HTTPException(409, "Lyrics changed while saving; try again")
            offset = float(latest.get("lyric_offset") or 0)
            identity = _plain_identity(latest.get("artist", ""), latest.get("title", ""))
            _save_viewer_selection(folder, identity, "synced", choice.id)

        if target is not None:
            target.update(lyrics=lines, lyrics_status="ready", viewer_lyrics_source="synced", lyrics_error=None, offset=offset,
                          lyrics_rev=target.get("lyrics_rev", 0) + (1 if changed else 0))
        if self.state.current and self.state.current["id"] == video_id:
            self.state.current.update(lyrics=lines, lyrics_status="ready", viewer_lyrics_source="synced", lyrics_error=None,
                                 lyrics_rev=self.state.current.get("lyrics_rev", 0) + (1 if changed else 0))
            if changed:
                self.state.offset = 0
                self.state.lyrics_sent.clear()
        await self.state.broadcast()
        return {"saved": choice.id, "changed": changed}

    async def choose_lyrics(self, video_id: str, choice: LyricChoice):
        """Save the chosen version; a current song switches immediately."""
        return await self.select_lyrics(video_id, choice)

    async def queued_lyrics(self, queue_key: str):
        item = self.queue_item(queue_key)
        folder, meta = self.library.song_meta(item["id"])
        raw = (folder / "lyrics.lrc").read_text(encoding="utf-8") if (folder / "lyrics.lrc").is_file() else ""
        lines = []
        try:
            timed = json.loads((folder / "timed.json").read_text(encoding="utf-8"))
            lines = (timed.get("lines") or []) if timed.get("key") == worker.timing_key(raw) else []
        except (OSError, ValueError, TypeError):
            lines = lyrics.parse_lrc(raw)
        if not lines and raw:
            lines = lyrics.parse_lrc(raw)
        return {"key": item["key"], "id": item["id"], "artist": item["artist"], "title": item["title"],
                "lyrics_status": item.get("lyrics_status", "missing"), "lyrics": lines,
                "raw": raw, "offset": float(meta.get("lyric_offset") or item.get("offset") or 0),
                "source": meta.get("lyrics_source")}

    async def choose_queued_lyrics(self, queue_key: str, choice: LyricChoice):
        item = next((item for item in self.state.upcoming if item["key"] == queue_key), None)
        if item is not None:
            if item["status"] != "ready":
                raise HTTPException(409, "Lyrics settings are not ready yet")
            return await self.select_lyrics(item["id"], choice, item)
        current = self.state.current if self.state.current and self.state.current.get("key") == queue_key else None
        if current is not None:
            return await self.select_lyrics(current["id"], choice)
        raise HTTPException(404, "Queue song not found")

    async def set_queued_offset(self, queue_key: str, choice: OffsetChoice):
        try:
            item = await self.state.set_queue_offset(queue_key, choice.value)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        await self.state.broadcast()
        return {"key": item["key"], "id": item["id"], "offset": item["offset"]}
