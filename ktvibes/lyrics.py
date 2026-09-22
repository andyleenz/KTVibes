"""Unicode LRC support. Run: uv run python -m ktvibes.lyrics ARTIST TITLE SECONDS"""
import asyncio
import json
import re
import sys

STAMP = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")
VOICE = re.compile(r"(v\d+):\s*")
WORD_STAMP = re.compile(r"<(\d+):(\d+(?:\.\d+)?)>")
# Chinese/Japanese/Korean highlight per character; other scripts per word.
CJK = "\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef"
UNIT = re.compile(rf"[{CJK}]\s*|[^\s{CJK}]+\s*|\s+")

def split_units(text: str) -> list[str]:
    return UNIT.findall(text)

def weight(unit: str) -> int:
    """Rough sung length: one per CJK character, one per vowel group in other words."""
    return max(1, len(re.findall(r"[aeiouyà-ÿ]+", unit, re.I))) if re.search(rf"[^\s{CJK}]", unit) else 1

def parse_lrc(raw: str) -> list[dict]:
    offset = re.search(r"\[offset:([+-]?\d+)\]", raw, re.I)
    shift = int(offset[1]) / 1000 if offset else 0
    lines = []
    for line in raw.splitlines():
        stamps = STAMP.findall(line)
        body = STAMP.sub("", line).strip()
        # Enhanced LRC: "<mm:ss.xx>word" gives real per-word timing.
        # Enhanced LRC duet tags ("v1:", "v2:") name the singer; keep them out of the text.
        voice = VOICE.match(body)
        body = body[voice.end():] if voice else body
        pieces = WORD_STAMP.split(body)
        text = "".join(pieces[::3]).strip()
        marks = [(pieces[i + 2], max(0, int(pieces[i]) * 60 + float(pieces[i + 1]) + shift)) for i in range(1, len(pieces) - 2, 3)]
        # A trailing empty "<mm:ss>" marks when the last word ends.
        words = [[w, start, marks[k + 1][1] if k + 1 < len(marks) else None] for k, (w, start) in enumerate(marks) if w]
        for minute, second in stamps:
            entry = {"t": max(0, int(minute) * 60 + float(second) + shift), "text": text}
            if voice:
                entry["voice"] = voice[1]
            if words and len(stamps) == 1:
                entry["units"], entry["exact"] = [list(w) for w in words], True
            lines.append(entry)
    lines.sort(key=lambda line: line["t"])
    for line, following in zip(lines, lines[1:] + [None]):
        units = line.get("units")
        if units:
            for unit, after in zip(units, units[1:] + [None]):
                if unit[2] is None:
                    unit[2] = after[1] if after else min(following["t"] if following else unit[1] + 1, unit[1] + 1.5)
    return lines

def add_pinyin(lines: list[dict]) -> list[dict]:
    """Append tone-marked pinyin to each unit; whole-line context picks polyphone readings (还是 hái, 了解 liǎo)."""
    from pypinyin import Style, lazy_pinyin
    for line in lines:
        units = line.get("units")
        if not units or not re.search(r"[\u3400-\u9fff\uf900-\ufaff]", line["text"]):
            continue
        text = "".join(u[0] for u in units)
        readings = iter(lazy_pinyin(text, style=Style.TONE, errors=lambda s: [""] * len(s)))
        for unit in units:
            unit[3:] = [" ".join(filter(None, (next(readings) for _ in unit[0])))]
    return lines

HANGUL = re.compile(r"[\uac00-\ud7a3]")
# Revised Romanization of Korean, per jamo.
INITIALS = "g kk n d tt r m b pp s ss  j jj ch k t p h".split(" ")
VOWELS = "a ae ya yae eo e yeo ye o wa wae oe yo u wo we wi yu eu ui i".split()
FINALS = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"]
_g2p = None

def romanize(syllables: str) -> list[str]:
    """Romanize Hangul syllables as sung. Input should already be the pronounced form."""
    out, previous_final = [], 0
    for char in syllables:
        code = ord(char) - 0xAC00
        initial, vowel, final = code // 588, code % 588 // 28, code % 28
        onset = "l" if initial == 5 and previous_final == 8 else INITIALS[initial]  # ㄹㄹ -> ll
        out.append(onset + VOWELS[vowel] + FINALS[final])
        previous_final = final
    return out

def add_korean_romanization(lines: list[dict]) -> list[dict]:
    """Romanize each Korean syllable from its sung pronunciation (눈물이 -> nun mu ri, 못하게 -> mo ta ge)."""
    global _g2p
    if _g2p is None:
        from g2pk2 import G2p
        _g2p = G2p()
    for line in lines:
        units = line.get("units")
        if not units or not HANGUL.search(line["text"]):
            continue
        written = HANGUL.findall(line["text"])
        spoken = HANGUL.findall(_g2p(line["text"]))
        # If sound changes altered the syllable count, fall back to the written form.
        readings = iter(romanize("".join(spoken if len(spoken) == len(written) else written)))
        for unit in units:
            syllables = HANGUL.findall(unit[0])
            if syllables and not (len(unit) > 3 and unit[3]):
                unit[3:] = [" ".join(next(readings) for _ in syllables)]
            elif syllables:
                for _ in syllables:
                    next(readings)
    return lines

def envelope(samples, rate: int, hop: float = 0.05):
    """RMS of the (mono) vocal stem in hop-second frames."""
    import numpy as np
    mono = np.asarray(samples, dtype=np.float32)
    mono = mono.mean(axis=1) if mono.ndim == 2 else mono
    size = max(1, int(rate * hop))
    frames = mono[: len(mono) // size * size].reshape(-1, size)
    return np.sqrt((frames ** 2).mean(axis=1))

def find_shift(lines: list[dict], energy, hop: float = 0.05, limit: float = 30.0) -> float:
    """Seconds to add to every stamp so the lines start where the vocals do.

    LRCLIB records follow the album track, and a music video often adds an intro;
    alignment only searches near each line, so it cannot recover a whole-song shift.
    Each candidate shift is scored by how much singing follows the shifted stamps
    compared with just before them.
    """
    import numpy as np
    energy = np.asarray(energy)
    starts = np.array([line["t"] for line in lines if line["text"]])
    if len(starts) < 10 or not len(energy):
        return 0.0
    active = (energy > np.percentile(energy, 95) * 0.15).astype(float)
    total = np.concatenate([[0.0], np.cumsum(active)])
    after, before = int(1 / hop), int(0.5 / hop)
    def score(shift):
        frames = np.round((starts + shift) / hop).astype(int)
        # Only lines whose windows fit in the audio count; a shift that pushes many out is not a fit.
        frames = frames[(frames >= before) & (frames + after <= len(active))]
        if len(frames) < 0.75 * len(starts):
            return -1.0
        return float(np.mean((total[frames + after] - total[frames]) / after - (total[frames] - total[frames - before]) / before))
    shifts = np.arange(-limit, limit + hop / 2, hop)
    scores = np.array([score(shift) for shift in shifts])
    best = int(scores.argmax())
    # Measured on cached songs: correct stamps score 0.26-0.55 as they are, while a
    # music video 3.3 s late scored 0.01 as is and 0.33 shifted; noise stays below 0.25.
    # Offsets under a second are left to per-line alignment.
    if scores[best] < 0.25 or score(0.0) > scores[best] / 2 or abs(shifts[best]) < 1:
        return 0.0
    return round(float(shifts[best]), 2)

def shift_lines(lines: list[dict], shift: float) -> list[dict]:
    for line in lines:
        line["t"] = round(max(0.0, line["t"] + shift), 2)
        for unit in line.get("units") or []:
            unit[1], unit[2] = round(max(0.0, unit[1] + shift), 2), round(max(0.0, unit[2] + shift), 2)
    return lines

def line_starts(lines: list[dict], lead: float = 0.3) -> list[dict]:
    """When each line takes over on the TV, from its sung words rather than its LRC stamp.

    A stamp can come before the previous line's last word is sung ("bark after dark"
    ends at 29.33, the next stamp is 29.03) or after a line's first word; a line
    becomes active shortly before its first word, but not before the previous
    line's last word ends, and never after its own first word.
    """
    previous_end = previous_start = 0.0
    for line in lines:
        units = line.get("units")
        first = units[0][1] if units else line["t"]
        start = min(max(first - lead if units else first, previous_end), first)
        line["start"] = previous_start = round(max(start, previous_start), 2)
        previous_end = units[-1][2] if units else line["t"]
    return lines

def time_units(lines: list[dict], energy, hop: float = 0.05) -> list[dict]:
    """Spread each line's characters/words over the time the vocal stem is audible.

    LRCLIB is mostly line-timed; the separated vocals tell us when singing
    happens inside each line, so the wipe pauses on breaths and gaps.
    """
    import numpy as np
    energy = np.asarray(energy)
    floor = float(np.percentile(energy, 95)) * 0.04 if len(energy) else 0
    for index, line in enumerate(lines):
        if line.get("units") or not line["text"]:
            continue
        units = split_units(line["text"])
        start = line["t"]
        end = lines[index + 1]["t"] if index + 1 < len(lines) else start + 8
        end = min(end, start + 15)
        window = energy[int(start / hop): max(int(start / hop) + 1, int(end / hop))]
        active = window > max(floor, float(np.percentile(window, 90)) * 0.25) if len(window) else window
        if active.sum() < 4:
            active = np.ones(max(1, int(min(end - start, len(units) * 0.4) / hop)), bool)
        clock = np.cumsum(active) * hop  # singing time elapsed at each frame end
        total = clock[-1]
        weights = np.cumsum([0] + [weight(u) for u in units]) / sum(weight(u) for u in units)
        def at(fraction, side):
            # "right": first frame singing past this point (a unit starts when singing resumes);
            # "left": frame where this point is reached (a unit ends when its singing finishes).
            frame = int(np.searchsorted(clock, fraction * total + (1e-9 if side == "right" else -1e-9), side))
            return round(start + min(frame, len(clock) - 1) * hop + (hop if side == "left" else 0), 2)
        line["units"] = [[unit, at(weights[i], "right") if i else start, at(weights[i + 1], "left")] for i, unit in enumerate(units)]
    return lines

def variants(name: str) -> list[str]:
    """'아이유(IU)' -> ['아이유(IU)', '아이유', 'IU']; '安靜 Silence' -> [..., '安靜', 'Silence'].

    LRCLIB often stores only one script of a bilingual name.
    """
    parts = [name, *re.split(r"\s*[(（]\s*|\s*[)）]\s*", name)]
    parts += re.findall(rf"[{CJK}][{CJK}\s]*", name) + re.findall(rf"[^\s{CJK}()（）][^{CJK}()（）]*", name)
    return list(dict.fromkeys(p.strip() for p in parts if p.strip()))

def rank(candidate: dict, titles: list[str], duration: float) -> tuple:
    track = candidate.get("trackName", "").casefold()
    return (not any(t.casefold() in track for t in titles), "instrumental" in track, abs(float(candidate["duration"]) - duration))

async def fetch(artist: str, title: str, duration: float) -> dict:
    import httpx
    def fits(c):
        # Some LRCLIB records put untimed text in syncedLyrics; require real timestamps.
        # Music videos often run a few seconds longer than the album track; alignment re-times the lines.
        return STAMP.search(c.get("syncedLyrics") or "") and abs(float(c.get("duration") or 0) - duration) <= 10
    artists, titles = variants(artist), variants(title)
    candidates = []
    async with httpx.AsyncClient(base_url="https://lrclib.net", timeout=20, headers={"User-Agent": "KTVibes/0.1 (home karaoke)"}) as client:
        response = await client.get("/api/get", params={"artist_name": artist, "track_name": title, "duration": round(duration)})
        if response.status_code == 200:
            candidates.append(response.json())
        searches = [{"artist_name": a, "track_name": t} for a in artists for t in titles] + [{"q": f"{a} {t}"} for a in artists for t in titles] + [{"track_name": t} for t in titles]
        failure = None
        for params in searches:
            if any(map(fits, candidates)):
                break
            # LRCLIB intermittently returns 5xx; retry, then move on to the next variant.
            for attempt in range(3):
                try:
                    response = await client.get("/api/search", params=params)
                    response.raise_for_status()
                    candidates += response.json()
                    break
                except (httpx.TransportError, httpx.HTTPStatusError) as error:
                    failure = error
                    if isinstance(error, httpx.HTTPStatusError) and error.response.status_code < 500:
                        break
                    await asyncio.sleep(1 + attempt)
        if failure and not candidates:
            raise failure
    matches = [c for c in candidates if fits(c)]
    best = min(matches, key=lambda c: rank(c, titles, duration)) if matches else {}
    raw = best.get("syncedLyrics", "")
    return {"raw": raw, "lines": parse_lrc(raw)}

if __name__ == "__main__":
    print(json.dumps(asyncio.run(fetch(sys.argv[1], sys.argv[2], float(sys.argv[3]))), ensure_ascii=False, indent=2))
