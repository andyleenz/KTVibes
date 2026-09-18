"""YouTube search/download. Run: uv run python -m ktvibes.youtube QUERY"""
import json
import re
import sys
import subprocess
from pathlib import Path

ID = re.compile(r"^[A-Za-z0-9_-]{11}$")

def parse_title(title: str, channel: str = "") -> dict:
    clean = re.sub(r"\s*[\[(（【][^\])）】]*(?:official|music video|lyrics?|mv|audio|官方|歌詞|歌词|뮤직비디오)[^\])）】]*[\])）】]", "", title, flags=re.I).strip()
    clean = re.sub(r"\s*[-–—|｜]?\s*(?:official\s+)?(?:music\s+video|mv|lyric video)\s*$", "", clean, flags=re.I).strip()
    bracketed = re.fullmatch(r"(.+?)\s*【([^】]+)】", clean)
    if bracketed:  # "周杰倫 Jay Chou【晴天 Sunny Day】"
        return {"artist": bracketed[1], "title": bracketed[2]}
    parts = re.split(r"\s+[-–—｜|]\s+", clean, maxsplit=1)
    return {"artist": parts[0] if len(parts) == 2 else re.sub(r"\s*- Topic$", "", channel), "title": parts[-1]}

def search(query: str) -> list[dict]:
    import yt_dlp
    with yt_dlp.YoutubeDL({"js_runtimes": {"node": {}}, "extract_flat": True, "quiet": True, "noprogress": True, "skip_download": True, "socket_timeout": 20}) as ydl:
        result = ydl.extract_info(f"ytsearch10:{query}", download=False)
    return [{"id": e["id"], "title": e.get("title", "Untitled"), "channel": e.get("channel") or e.get("uploader", ""),
             "duration": e.get("duration"), "thumbnail": f'https://i.ytimg.com/vi/{e["id"]}/mqdefault.jpg',
             "parsed": parse_title(e.get("title", ""), e.get("channel") or e.get("uploader", ""))}
            for e in result.get("entries", []) if e and ID.fullmatch(e.get("id", ""))]

def download(video_id: str, directory: Path) -> dict:
    if not ID.fullmatch(video_id):
        raise ValueError("Invalid YouTube ID")
    directory.mkdir(parents=True, exist_ok=True)
    import yt_dlp
    with yt_dlp.YoutubeDL({"js_runtimes": {"node": {}}, "format": "bestaudio[ext=m4a]/bestaudio", "outtmpl": str(directory / "audio.%(ext)s"),
                          "noplaylist": True, "quiet": True, "noprogress": True, "socket_timeout": 30,
                          "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "m4a"}]}) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
    return {"duration": info.get("duration"), "source_title": info.get("title", "")}

def download_video(video_id: str, directory: Path) -> None:
    """Cache browser-compatible H.264 video with no embedded audio."""
    if not ID.fullmatch(video_id):
        raise ValueError("Invalid YouTube ID")
    directory.mkdir(parents=True, exist_ok=True)
    source = directory / "video-source.mp4"
    import yt_dlp
    with yt_dlp.YoutubeDL({
        "js_runtimes": {"node": {}},
        "format": "bestvideo[ext=mp4][vcodec^=avc1][height<=1080]/best[ext=mp4][vcodec^=avc1][height<=720]",
        "outtmpl": str(source), "noplaylist": True, "quiet": True, "noprogress": True, "socket_timeout": 30,
    }) as ydl:
        ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
    temporary = directory / "video.tmp.mp4"
    subprocess.run(["ffmpeg", "-nostdin", "-y", "-i", str(source), "-map", "0:v:0", "-an",
                    "-c:v", "copy", "-movflags", "+faststart", str(temporary)],
                   check=True, capture_output=True)
    temporary.replace(directory / "video.mp4")
    source.unlink(missing_ok=True)

if __name__ == "__main__":
    print(json.dumps(search(" ".join(sys.argv[1:]) or "bohemian rhapsody"), ensure_ascii=False, indent=2))
