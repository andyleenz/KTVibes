# KTVibes

Home karaoke: pick YouTube songs on your phone, watch the original muted video on the TV, and sing over a separated instrumental track. Synced lyrics appear at the bottom. English, Chinese (simplified/traditional), and Korean text are preserved throughout search, metadata, cache, and lyrics.

## Run

Requires `uv`, Node.js 22+ (Node 25 works), `ffmpeg`/`ffprobe`, network access, and on Linux/Windows an NVIDIA driver supporting CUDA 12.8 (see macOS below). Python 3.12 is pinned; `uv` installs it when needed. PyTorch and torchaudio are pinned to 2.7.1 from the CUDA 12.8 index for the RTX 5070.

```bash
cd ~/Work/KTVibes
uv sync
uv run python -c "import torch; print(torch.__version__, torch.version.cuda); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"
uv run ktvibes
```

### macOS (Apple Silicon)

No NVIDIA driver is needed. On macOS, `uv sync` installs the standard PyTorch 2.7.1 wheels, and Demucs runs on the Mac GPU (MPS); forced alignment runs on the CPU. Other machines without CUDA fall back to the CPU for both. Install the tools with `brew install uv ffmpeg`, then:

```bash
uv sync
uv run python -c "import torch; print(torch.__version__, torch.backends.mps.is_available())"
uv run ktvibes
```

uv's standalone Python on macOS has no CA bundle, so `ktvibes/__init__.py` sets `SSL_CERT_FILE` to certifi's bundle for model and NLTK downloads. Measured on an M1 Pro: separating a 6:00 song took 33.6 s with the model loaded, or 48.5 s on the first run, which also loads the model (the 80 MB weights were downloaded in that same run).

`uv run ktvibes` serves on port 8765 (set `KTVIBES_PORT` to change it). Run one server process (no `--workers`): queue state and the GPU model live in memory.

- TV/PC: open `http://localhost:8765/tv`, click **Enable sound**, then optionally **Fullscreen**.
- Phone: scan the TV QR code while on the same Wi-Fi, or open `http://<pc-ip>:8765/`.
- Search, select a result, correct artist/title if needed, and add it. Original-language names usually give the best lyric matches.
- The first song starts when ready; a five-second card introduces each song. The worker prepares the rest of the queue during playback.
- Pause, skip, reorder, or remove upcoming songs from the phone. Drag the position slider on the phone, or click the TV progress bar, to jump within the song. **Lyric size** scales the TV lyrics from 60% to 180%.
- The TV shows the current song at the top left and the next three songs at the top right. Guide vocals default to 10%; set to 0 for instrumental only. Positive lyric offsets show the lyrics earlier; negative offsets show them later.

Set `KTVIBES_REMOTE_URL=http://<pc-ip>:8765/` if the detected address is wrong (for example with a VPN). `KTVIBES_CACHE=/some/path` changes the media cache directory. One TV controls playback at a time. The TV page opened most recently takes over, so reloading the TV never locks it out; multiple phone remotes are supported. A reloaded TV resumes near its last reported position after sound is enabled again.

YouTube extraction explicitly enables Node and includes the [yt-dlp EJS components](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

## Media and lyrics

Each `cache/<youtube_id>/` holds `audio.m4a`, `video.mp4`, `vocals.wav`, `no_vocals.wav`, `lyrics.lrc`, and `meta.json`. The video is H.264, up to 1080p; embedded audio is stripped without re-encoding the video. Only the two separated WAV tracks produce sound. The instrumental clock drives the guide vocals, video alignment, progress, and lyric highlighting. A failed video download falls back to the stage background; missing lyrics do not stop playback.

Demucs `htdemucs` loads once, runs on CUDA in a background thread, and sums the non-vocal stems. Model weights download on first use. Processing time depends on song length, network speed, and whether the model is warm; the 30-second target requires measurement on the actual GPU. Float WAV preserves stem headroom and consumes more disk space than compressed audio. Existing stems are reused, and cached lyrics are looked up again if you edit artist/title.

[LRCLIB](https://lrclib.net/docs) supplies synced lyrics through `/api/get` and a `/api/search` fallback. Candidates must be within three seconds of the actual audio duration. Chinese and Korean lyrics use the same lookup and timing path; coverage depends on LRCLIB. Lyric lookup also tries each part of a bilingual name. `아이유(IU)` searches `아이유` and `IU`, and `周杰倫 Jay Chou` / `安靜 Silence` searches `周杰倫` + `安靜`. An empty lyric result is not cached, so the next preparation of that song looks it up again. a bare `아이유` still misses because LRCLIB files IU under the Latin name.

The TV highlights lyrics KTV-style: Chinese, Japanese, and Korean lines fill one character at a time; other scripts fill one word at a time. Enhanced LRC `<mm:ss.xx>` word stamps are used when present. LRCLIB records are usually line-timed. KTVibes times each character or word by forced alignment. torchaudio's multilingual MMS aligner, running on the GPU, matches the romanized line (pinyin, Korean romanization, or plain English letters) against the separated vocals within that line's window. Word starts are moved 0.1 s earlier because the aligner marks words slightly late. If the aligner's mean confidence for a line is below 0.2, that line uses a vocal-energy estimate instead: the line is spread across the frames where the vocals are audible.

Measured against APT. (Rosé and Bruno Mars), the only LRCLIB record found with real per-word timestamps (89 word starts): mean error 0.094 s with alignment versus 0.167 s with the energy estimate. Median error was 0.045 s versus 0.096 s, and 83% versus 64% of word starts were within 0.15 s. The 0.1 s lead and 0.2 confidence cutoff were chosen on that same song, so these numbers are optimistic. Chinese and Korean have no answer key; on cached songs, 57–100% of lines passed the confidence check. Long held notes remain the weak spot: a held first word can squeeze the next word early. The first run downloads the 1.18 GB aligner model; aligning takes 1–5 s per song.

Enhanced LRC duet tags (`v1:`, `v2:`) are removed from the displayed text and stored as the line's `voice`. A pronunciation guide sits above the lyrics and fills along with each character or word. The **Pronunciation guide** button on the remote, or the G key on the TV, cycles through the modes mid-song. The TV shows a badge for 1.5 s after each change. The cycle skips modes with nothing to show for the current song.

- **Romanization:** tone-marked pinyin for Chinese, generated by `pypinyin` from the whole line so that most polyphones read correctly (还是 hái, 了解 liǎo). Korean gets romanization of the sung pronunciation.
- **한글:** Hangul for Chinese and English lines. Chinese follows the standard Korean spelling of Chinese sounds (晴天 칭톈, 周杰伦 저우제룬). English goes through the CMU pronouncing dictionary and simple Korean spelling rules (someone 섬원, crazy 크레이지). Words missing from the dictionary, such as `tryna`, get no guide. Unstressed vowels follow spoken English, so some words differ from the standard spelling (beautiful 뷰터펄, not 뷰티풀).
- **Off.**

Some readings are still wrong: for example, the particle 得 in 舍不得 shows `dé` instead of `de`. Translation is not added. Music videos with long intros may need the timing nudge, or may not have a duration-matched lyric record. Choose an audio version if the music video has extra scenes.

## Checks

```bash
uv run python -m unittest discover -s tests -v
uv run pytest
uv run python -m ktvibes.youtube 'bohemian rhapsody'
uv run python -m ktvibes.lyrics 'Queen' 'Bohemian Rhapsody' 354
uv run python -m ktvibes.youtube '周杰倫 晴天'
uv run python -m ktvibes.youtube '아이유 좋은 날'
```

Standalone download and timed separation:

```bash
uv run python -c "from pathlib import Path; from ktvibes.youtube import download, download_video; p=Path('cache/fJ9rUzIMcZQ'); print(download('fJ9rUzIMcZQ', p)); download_video('fJ9rUzIMcZQ', p)"
uv run python -m ktvibes.separate cache/fJ9rUzIMcZQ/audio.m4a cache/fJ9rUzIMcZQ
```

## Verification (2026-09-18, RTX 5070, driver 610.57.04)

Real providers and hardware, not fixtures:

- `uv sync` completed. torch 2.7.1+cu128 reports CUDA available with arch list through `sm_120`; a 4096×4096 matmul on the GPU returned a result.
- 14 unit/API tests pass, including the three API tests that were previously skipped. The word-timing test uses a synthetic energy envelope.
- YouTube search returned results for `周杰伦 晴天`, `아이유 좋은 날`, and `Adele Someone Like You`.
- Downloads: IU `V6WWJNpIJN4` and Adele `hLQl3WQQoQ0` gave 1920×1080 H.264 video with no audio stream. Jay Chou `DYptgVvkVLQ` gave 640×480, the best H.264 format that YouTube offers for that video.
- Demucs htdemucs separation: 13.0 s for a 236 s song on first use (includes the 80 MB weight download and model load), 5.3 s for a 285 s song with a warm model.
- LRCLIB returned synced lyrics for all three songs (Korean 36 lines, Chinese 41, English 44).
- Browser (agent-browser, headed Chromium): the remote and TV ran in separate tabs. Sound was enabled on the TV, and songs were queued from the phone-sized remote in Korean and Chinese, with the artist and title edited before adding. Verified: status progression (downloading → ready, with 晴天 prepared while the IU song played), muted video playing in step with the instrumental and vocals (currentTime values within 0.01 s), the Korean highlighted line matching the lyrics burned into the video, per-character (Korean/Chinese) and per-word (English) fill, guide vocal level and offset changes reaching the TV, pause, skip, reorder, remove, the five-second Up next card, automatic advance at song end, and no console errors.
- Not verified: audible mix quality (screenshots cannot hear audio), and the phone remote on a real phone over Wi-Fi (tested only at a phone-sized viewport on the same machine).

Known limitations:

- A hidden TV tab does not start the next song, because browsers pause `requestAnimationFrame` in hidden tabs. The song starts as soon as the tab is visible again. Keep the TV page in the foreground.
- If the browser blocks autoplay (`NotAllowedError`), the Enable sound prompt appears again. Other start errors are logged to the console and retried.
- Title parsing is a best guess. Always check the artist and title before adding a song; the original-script artist name or the name LRCLIB uses gives the best lyric matches.

For a full browser check, open the remote and TV in separate tabs, enable sound, then queue two songs. Confirm downloading → separating → ready, muted video playback with instrumental audio, highlighted lyrics, guide vocals, both offset buttons, pause/resume, skip, reordering, and automatic advance. Verify the second track is ready while the first is playing. Screenshots alone cannot verify audible mixing or sync.

## Layout

`ktvibes/main.py` serves the API, WebSocket, media range requests, QR, and static pages. `queue.py` owns state, and `worker.py` prepares one entry at a time. `youtube.py`, `lyrics.py`, and `separate.py` wrap the external providers. The frontend is plain HTML/CSS/JavaScript with no build step.

Queue state resets on restart; the media cache persists. Microphone input, scoring, pitch shift, authentication, and persistent queues are outside this MVP. The remote is intended for your local network.
