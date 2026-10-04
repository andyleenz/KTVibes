# How KTVibes works

## Running on different hardware

Python 3.12 is pinned; `uv` installs it when needed. PyTorch and torchaudio 2.7.1 come from the CUDA 12.8 index on Linux and Windows.

### macOS (Apple Silicon)

No NVIDIA driver is needed. On macOS, `uv sync` installs the standard PyTorch 2.7.1 wheels, and Demucs runs on the Mac GPU (MPS); forced alignment runs on the CPU. Other machines without CUDA fall back to the CPU for both. Install the tools with `brew install uv ffmpeg`, then:

```bash
uv sync
uv run python -c "import torch; print(torch.__version__, torch.backends.mps.is_available())"
uv run ktvibes
```

uv's standalone Python on macOS has no CA bundle, so `ktvibes/__init__.py` sets `SSL_CERT_FILE` to certifi's bundle for model and NLTK downloads. Measured on an M1 Pro: separating a 6:00 song took 33.6 s with the model loaded, or 48.5 s on the first run, which also loads the model (the 80 MB weights were downloaded in that same run).

## Media

Each `cache/<youtube_id>/` holds `audio.m4a`, `video.mp4`, `vocals.opus`, `no_vocals.opus`, `lyrics.lrc`, `timed.json`, and `meta.json`. `timed.json` keeps the per-word timing and pronunciation guides, so re-queuing a song skips alignment; it is rebuilt when the lyrics change. The lyric timing nudge is saved in `meta.json` and applies the next time the song plays. The stems are Ogg Opus at about 160 kbit/s (older FLAC or WAV stems convert the next time the song is queued). The video is H.264, up to 720p by default (`KTVIBES_VIDEO_HEIGHT`); embedded audio is stripped without re-encoding the video. Only the two separated tracks produce sound. The instrumental clock drives the guide vocals, video alignment, progress, and lyric highlighting. The video downloads alongside the audio and separation, and a failed video download falls back to the stage background; missing lyrics do not stop playback.

Demucs `htdemucs` loads once, runs on CUDA in a background thread, and sums the non-vocal stems. Model weights download on first use. Processing time depends on song length, network speed, and whether the model is warm; the 30-second target requires measurement on the actual GPU. Stems are stored as lossless 24-bit FLAC, 41–52% of the size of float WAV (about 65 MB instead of 150 MB for a 3–4 minute song). Separated stems often peak above full scale, which FLAC cannot store, so both are scaled down together and `meta.json` keeps the `stem_gain` the TV applies to restore the level. Songs cached as float WAV by older versions convert to FLAC (about a second) the next time they are queued. Existing stems are reused, and cached lyrics are looked up again if you edit artist/title.

[LRCLIB](https://lrclib.net/docs) supplies synced lyrics through `/api/get` and a `/api/search` fallback. Candidates must be within three seconds of the actual audio duration. Chinese and Korean lyrics use the same lookup and timing path; coverage depends on LRCLIB. Lyric lookup also tries each part of a bilingual name. `아이유(IU)` searches `아이유` and `IU`, and `周杰倫 Jay Chou` / `安靜 Silence` searches `周杰倫` + `安靜`. An empty lyric result is not cached, so the next preparation of that song looks it up again. a bare `아이유` still misses because LRCLIB files IU under the Latin name.

The TV highlights lyrics KTV-style: Chinese, Japanese, and Korean lines fill one character at a time; other scripts fill one word at a time. Enhanced LRC `<mm:ss.xx>` word stamps are used when present. LRCLIB records are usually line-timed. KTVibes times each character or word by forced alignment. torchaudio's multilingual MMS aligner, running on the GPU, matches the romanized line (pinyin, Korean romanization, or plain English letters) against the separated vocals within that line's window. Word starts are moved 0.1 s earlier because the aligner marks words slightly late. If the aligner's mean confidence for a line is below 0.2, that line uses a vocal-energy estimate instead: the line is spread across the frames where the vocals are audible.

Measured against APT. (Rosé and Bruno Mars), the only LRCLIB record found with real per-word timestamps (89 word starts): mean error 0.094 s with alignment versus 0.167 s with the energy estimate. Median error was 0.045 s versus 0.096 s, and 83% versus 64% of word starts were within 0.15 s. The 0.1 s lead and 0.2 confidence cutoff were chosen on that same song, so these numbers are optimistic. Chinese and Korean have no answer key; on cached songs, 57–100% of lines passed the confidence check. Long held notes remain the weak spot: a held first word can squeeze the next word early. The first run downloads the 1.18 GB aligner model; aligning takes 1–5 s per song.

Enhanced LRC duet tags (`v1:`, `v2:`) are removed from the displayed text and stored as the line's `voice`. A pronunciation guide sits above the lyrics and fills along with each character or word. The **Pronunciation guide** button on the remote, or the G key on the TV, cycles through the modes mid-song. The TV shows a badge for 1.5 s after each change. The cycle skips modes with nothing to show for the current song.

- **Jyutping:** Cantonese readings for Chinese characters (`ToJyutping`). It is chosen automatically when the lyrics contain written-Cantonese characters such as 嘅, 咗 or 唔.
- **Romanization (Japanese):** Japanese songs (any kana in the lyrics) get Hepburn romaji from `pykakasi`; a kanji word's reading sits on its first character, and some kanji readings are wrong.
- **Romanization:** tone-marked pinyin for Chinese, generated by `pypinyin` from the whole line so that most polyphones read correctly (还是 hái, 了解 liǎo). Korean gets romanization of the sung pronunciation.
- **한글:** Hangul for Chinese and English lines. Chinese follows the standard Korean spelling of Chinese sounds (晴天 칭톈, 周杰伦 저우제룬). English goes through the CMU pronouncing dictionary and simple Korean spelling rules (someone 섬원, crazy 크레이지). Words missing from the dictionary, such as `tryna`, get no guide. Unstressed vowels follow spoken English, so some words differ from the standard spelling (beautiful 뷰터펄, not 뷰티풀).
- **Off.**

Some readings are still wrong: for example, the particle 得 in 舍不得 shows `dé` instead of `de`. Translation is not added. Music videos with long intros may need the timing nudge, or may not have a duration-matched lyric record. Choose an audio version if the music video has extra scenes.
