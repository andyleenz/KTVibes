"""YouTube search/download. Run: uv run python -m ktvibes.youtube QUERY"""
import json
import os
import re
import sys
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

ID = re.compile(r"^[A-Za-z0-9_-]{11}$")

def suggest(query: str) -> list[str]:
    """YouTube's own search-box completions for a partial query."""
    url = "https://suggestqueries.google.com/complete/search?" + urllib.parse.urlencode({"client": "firefox", "ds": "yt", "q": query})
    with urllib.request.urlopen(url, timeout=3) as response:
        return [s for s in json.loads(response.read().decode("utf-8", "replace"))[1] if isinstance(s, str) and not NOT_MUSIC.search(s)][:8]

def parse_title(title: str, channel: str = "") -> dict:
    clean = re.sub(r"\s*[\[(（【][^\])）】]*(?:official|music video|lyrics?|mv|audio|4k|hd|hq|remaster(?:ed)?|官方|歌詞|歌词|뮤직비디오)[^\])）】]*[\])）】]", "", title, flags=re.I).strip()
    clean = re.sub(r"[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F]", "", clean).strip()  # emoji: "(Lyrics) 🎵"
    clean = re.sub(r"\s*(?:[-–—|｜]|//)?\s*(?:official\s+)?(?:music\s+video|mv|lyric video|lyrics?)\s*$", "", clean, flags=re.I).strip()
    bracketed = re.match(r"(.+?)\s*【([^】]+)】", clean)
    if bracketed:  # "周杰倫 Jay Chou【晴天 Sunny Day】", even with a trailing "華視偶像劇…片尾曲"
        return {"artist": bracketed[1], "title": bracketed[2]}
    parts = re.split(r"\s+[-–—｜|]\s+", clean, maxsplit=1)
    channel = re.sub(r"\s*- Topic$", "", channel)
    if len(parts) == 2 and channel and same_name(parts[1], channel) and not same_name(parts[0], channel):
        parts.reverse()  # "Numb [4K Upgrade] - Linkin Park" on the Linkin Park channel: title first
    return {"artist": parts[0] if len(parts) == 2 else channel, "title": parts[-1]}

def same_name(a: str, b: str) -> bool:
    """Loose name match, ignoring case, spaces, punctuation and a "VEVO"/"Official" suffix."""
    key = lambda s: re.sub(r"(?:vevo|official)$", "", re.sub(r"\W", "", s.casefold()))
    return bool(key(a)) and key(a) == key(b)

# Searches are for songs to sing: these are rarely the song itself, or lack the vocals that separation needs.
NOT_MUSIC = re.compile(r"\b(?:reactions?|react(?:s|ing)?|dance practice|dance break|choreography|tutorial|lesson|how to|"
                       r"compilation|playlist|mix|nonstop|full album|karaoke|instrumental|inst\.|8d audio|sped up|slowed|"
                       r"behind the scenes|interview|vlog|teaser|trailer|shorts?)\b|#shorts", re.I)

def is_music(title: str, duration) -> bool:
    """A plausible single song: 1-10 minutes, and not a reaction, lesson, mix or similar."""
    return not NOT_MUSIC.search(title or "") and (duration is None or 60 <= duration <= 600)

def search(query: str, page: int = 0, size: int = 10) -> list[dict]:
    """One page of results; YouTube search has no offset, so later pages fetch the earlier ones too."""
    import yt_dlp
    first, last = page * size + 1, (page + 1) * size
    with yt_dlp.YoutubeDL({**base_options(), "extract_flat": True, "quiet": True, "noprogress": True, "skip_download": True,
                           "socket_timeout": 20, "playlist_items": f"{first}-{last}"}) as ydl:
        result = ydl.extract_info(f"ytsearch{last}:{query}", download=False)
    return [{"id": e["id"], "title": e.get("title", "Untitled"), "channel": e.get("channel") or e.get("uploader", ""),
             "duration": e.get("duration"), "thumbnail": f'https://i.ytimg.com/vi/{e["id"]}/mqdefault.jpg',
             "parsed": parse_title(e.get("title", ""), e.get("channel") or e.get("uploader", ""))}
            for e in result.get("entries", []) if e and ID.fullmatch(e.get("id", "")) and is_music(e.get("title", ""), e.get("duration"))]

def _extract(options: dict, video_id: str, progress=None, attempts: int = 4) -> dict:
    """Download with fresh stream URLs on HTTP 403, which YouTube returns intermittently.

    progress(fraction) is called from yt-dlp's download thread.
    """
    import yt_dlp
    if progress:
        def hook(d):
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if d.get("status") == "downloading" and total:
                progress(min(1.0, d.get("downloaded_bytes", 0) / total))
        options = {**options, "progress_hooks": [hook]}
    for attempt in range(attempts):
        try:
            with yt_dlp.YoutubeDL(options) as ydl:
                return ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
        except yt_dlp.utils.DownloadError as error:
            if "403" not in str(error) or attempt == attempts - 1:
                raise
            time.sleep(3 * (attempt + 1))

def download(video_id: str, directory: Path, progress=None) -> dict:
    if not ID.fullmatch(video_id):
        raise ValueError("Invalid YouTube ID")
    directory.mkdir(parents=True, exist_ok=True)
    info = _extract({**base_options(), "format": "bestaudio[ext=m4a]/bestaudio", "outtmpl": str(directory / "audio.%(ext)s"),
                     "noplaylist": True, "quiet": True, "noprogress": True, "socket_timeout": 30,
                     "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "m4a"}]}, video_id, progress)
    return {"duration": info.get("duration"), "source_title": info.get("title", "")}

VIDEO_HEIGHT = int(os.environ.get("KTVIBES_VIDEO_HEIGHT", 720))
BOT_CHECK = re.compile(r"confirm you.re not a bot", re.I)
BOT_HELP = ("YouTube wants this computer to prove it isn't a bot (it happens after many downloads). "
            "Wait a while and Retry, or let KTVibes use your browser's YouTube login: see KTVIBES_COOKIES_FROM_BROWSER in the README.")

def explain(error: Exception) -> str:
    """A yt-dlp error in words a host can act on."""
    return BOT_HELP if BOT_CHECK.search(str(error)) else str(error)[-500:]

def base_options() -> dict:
    """yt-dlp options for every request: Node.js for YouTube's player code, and optionally a browser's
    YouTube cookies (KTVIBES_COOKIES_FROM_BROWSER=chrome), which gets past YouTube's bot check."""
    browser = os.environ.get("KTVIBES_COOKIES_FROM_BROWSER")
    return {"js_runtimes": {"node": {}}, **({"cookiesfrombrowser": (browser,)} if browser else {})}

def download_video(video_id: str, directory: Path, progress=None) -> None:
    """Cache browser-compatible H.264 video with no embedded audio; 720p is about half the size of 1080p."""
    if not ID.fullmatch(video_id):
        raise ValueError("Invalid YouTube ID")
    directory.mkdir(parents=True, exist_ok=True)
    source = directory / "video-source.mp4"
    _extract({
        **base_options(),
        "format": f"bestvideo[ext=mp4][vcodec^=avc1][height<={VIDEO_HEIGHT}]/best[ext=mp4][vcodec^=avc1][height<={min(VIDEO_HEIGHT, 720)}]",
        "outtmpl": str(source), "noplaylist": True, "quiet": True, "noprogress": True, "socket_timeout": 30,
    }, video_id, progress)
    temporary = directory / "video.tmp.mp4"
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-i", str(source), "-map", "0:v:0", "-an",
                    "-c:v", "copy", "-movflags", "+faststart", str(temporary)],
                   check=True, capture_output=True)
    temporary.replace(directory / "video.mp4")
    source.unlink(missing_ok=True)

if __name__ == "__main__":
    print(json.dumps(search(" ".join(sys.argv[1:]) or "bohemian rhapsody"), ensure_ascii=False, indent=2))
