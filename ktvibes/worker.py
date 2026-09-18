import asyncio
import json
import logging
from pathlib import Path
import soundfile as sf
from . import youtube, lyrics

log = logging.getLogger(__name__)

def separate(source, destination):
    # Keep model imports off the server startup path.
    from .separate import separate as separate_audio
    return separate_audio(source, destination)

async def run(state, cache: Path):
    while True:
        state.wake.clear()
        item = next((i for i in state.upcoming if i["status"] == "queued"), None)
        if item is None:
            await state.wake.wait()
            continue
        folder = cache / item["id"]
        try:
            folder.mkdir(parents=True, exist_ok=True)
            meta_path = folder / "meta.json"
            try:
                meta = json.loads(meta_path.read_text())
            except (OSError, ValueError):
                meta = {}
            if not (folder / "video.mp4").is_file():
                item["status"] = "downloading"
                await state.broadcast()
                try:
                    await asyncio.to_thread(youtube.download_video, item["id"], folder)
                except Exception:
                    log.exception("Video unavailable for %s", item["id"])
                    item["video_warning"] = "Video unavailable; using the stage background."
            item["video"] = (folder / "video.mp4").is_file()
            stems_ready = all((folder / name).is_file() for name in ("vocals.wav", "no_vocals.wav"))
            if not stems_ready:
                item["status"] = "downloading"
                await state.broadcast()
                if not (folder / "audio.m4a").is_file():
                    meta.update(await asyncio.to_thread(youtube.download, item["id"], folder))
                item["status"] = "separating"
                await state.broadcast()
                meta["separation_seconds"] = await asyncio.to_thread(separate, folder / "audio.m4a", folder)
            item["duration"] = sf.info(folder / "no_vocals.wav").duration
            identity = [item["artist"], item["title"]]
            cached = (folder / "lyrics.lrc").read_text(encoding="utf-8") if (folder / "lyrics.lrc").is_file() else ""
            if meta.get("lyrics_identity") == identity and lyrics.parse_lrc(cached):
                item["lyrics"] = lyrics.parse_lrc(cached)
            else:
                try:
                    result = await lyrics.fetch(*identity, item["duration"])
                    item["lyrics"] = result["lines"]
                    # Cache only hits, so a later lookup fix or LRCLIB addition is picked up.
                    if result["raw"]:
                        (folder / "lyrics.lrc").write_text(result["raw"], encoding="utf-8")
                        meta["lyrics_identity"] = identity
                except Exception:
                    log.exception("Lyrics unavailable for %s", item["id"])
                    item["lyrics_warning"] = "Lyrics unavailable; audio is ready."
            if item["lyrics"]:
                try:
                    samples, rate = await asyncio.to_thread(sf.read, folder / "vocals.wav", dtype="float32")
                    item["lyrics"] = lyrics.add_pinyin(lyrics.time_units(item["lyrics"], lyrics.envelope(samples, rate)))
                except Exception:
                    log.exception("Word timing unavailable for %s", item["id"])
            meta.update(duration=item["duration"], artist=item["artist"], title=item["title"])
            temporary = folder / "meta.tmp"
            temporary.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            temporary.replace(meta_path)
            item["status"] = "ready"
            state.promote()
        except Exception as exc:
            log.exception("Preparation failed for %s", item["id"])
            item["status"] = "error"
            item["error"] = str(exc)[-500:]
            state.promote()
        await state.broadcast()
