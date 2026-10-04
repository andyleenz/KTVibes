"""Per-character/word lyric timing by forced alignment on the separated vocals.

LRCLIB gives line start times. Inside each line, torchaudio's multilingual MMS
aligner finds where each romanized character or word is sung. Lines it cannot
align confidently keep the vocal-energy estimate from lyrics.time_units.
"""
import re
import threading
import unicodedata
from .lyrics import CJK, HANGUL, echo, japanese, line_end, romaji, romanize, split_units

_bundle = _model = None
_lock = threading.Lock()
HAN = re.compile(r"[㐀-鿿豈-﫿]")
MIN_SCORE = 0.2  # Mean token probability below this means the aligner is guessing.
LEAD = 0.1  # The aligner marks words ~0.1s after they begin; karaoke should never lag.

def spoken_letters(units: list[str]) -> list[str]:
    """Romanize each unit into the aligner's a-z alphabet ('' when nothing is sung)."""
    from pypinyin import Style, lazy_pinyin
    text = "".join(units)
    han = iter(lazy_pinyin("".join(HAN.findall(text)), style=Style.NORMAL))
    out = []
    for unit in units:
        parts = []
        for char in unit:
            if HAN.match(char):
                parts.append(next(han))
            elif HANGUL.match(char):
                parts.extend(romanize(char))
            else:
                parts.append(unicodedata.normalize("NFKD", char))
        out.append(re.sub(r"[^a-z']", "", "".join(parts).lower().replace("’", "'")))
    return out

def _load():
    global _bundle, _model
    if _model is None:
        import torch
        from torchaudio.pipelines import MMS_FA
        _bundle = MMS_FA
        _model = MMS_FA.get_model().to("cuda" if torch.cuda.is_available() else "cpu").eval()
    return _bundle, _model

def runs(lines: list[dict], words: dict[int, list[str]], longest: float = 30) -> list[list[int]]:
    """Consecutive lines to align together, so the sung audio (not the LRC stamps) decides where one
    line ends and the next begins. A run breaks at an instrumental gap (an empty line), at lines that
    can't be aligned, and before it grows past `longest` seconds. A backing-vocal line, sung over the
    lead, is aligned on its own."""
    groups, current = [], []
    for index, line in enumerate(lines):
        if index not in words or echo(line):
            if current:
                groups.append(current)
            current = []
            if index in words:
                groups.append([index])
            continue
        if current and line_end(lines, index) - lines[current[0]]["t"] > longest:
            groups.append(current)
            current = []
        current.append(index)
    return groups + ([current] if current else [])

def align(lines: list[dict], samples, rate: int, pad: float = 0.4) -> set[int]:
    """Time units for every line the aligner is confident about. Returns aligned line indexes."""
    import torch
    import torchaudio.functional as F
    with _lock:
        bundle, model = _load()
        device = next(model.parameters()).device
        mono = torch.as_tensor(samples, dtype=torch.float32)
        mono = mono.mean(dim=1) if mono.ndim == 2 else mono
        audio = F.resample(mono, rate, bundle.sample_rate)
        tokenizer, aligner = bundle.get_tokenizer(), bundle.get_aligner()
        is_japanese = japanese(lines)
        units, letters = {}, {}
        for index, line in enumerate(lines):
            if not line["text"] or line.get("exact"):
                continue  # Enhanced LRC already has real word timing.
            units[index] = split_units(line["text"])
            # Japanese is aligned on its romaji; kana have no a-z letters of their own.
            letters[index] = [re.sub(r"[^a-z']", "", r.lower()) for r in romaji(units[index])] if is_japanese else spoken_letters(units[index])
        words = {index: [w for w in found if w] for index, found in letters.items() if any(found)}
        aligned = set()

        def place(group: list[int], start: float, end: float, context: tuple[int, ...] = ()):
            """Align `group`'s lines together in [start, end]; lines in `context` only steer the others."""
            clip = audio[int(start * bundle.sample_rate): int(end * bundle.sample_rate)]
            if len(clip) < bundle.sample_rate // 2:
                return
            with torch.inference_mode():
                emission, _ = model(clip[None].to(device))
            try:
                spans = iter(aligner(emission[0], tokenizer([w for index in group for w in words[index]])))
            except Exception:
                return  # Too many letters for the clip length.
            seconds = clip.shape[0] / bundle.sample_rate / emission.shape[1]
            for index in group:
                mine = [next(spans) for _ in words[index]]
                # Mean token probability below MIN_SCORE means the aligner is guessing on this line.
                if index in context or sum(s.score for word in mine for s in word) / sum(len(word) for word in mine) < MIN_SCORE:
                    continue
                timed = iter(mine)
                result, last = [], start
                for unit, letter in zip(units[index], letters[index]):
                    if letter:
                        word = next(timed)
                        a, b = start + word[0].start * seconds - LEAD, start + word[-1].end * seconds - LEAD
                        result.append([unit, round(a, 2), round(b, 2)])
                        last = b
                    else:
                        result.append([unit, round(last, 2), round(last, 2)])  # punctuation/space
                lines[index]["units"] = result
                aligned.add(index)

        previous = []
        for group in runs(lines, words):
            # A run split only for length re-aligns the line before it as context (its timing is kept from
            # the earlier run), so the first line of this run can't be pulled back over the end of that one.
            context = previous[-1:] if previous and previous[-1] + 1 == group[0] and not echo(lines[group[0]]) else []
            previous = group
            place(context + group, max(0.0, lines[(context or group)[0]]["t"] - pad), line_end(lines, group[-1]) + pad, tuple(context))
        # A line the run couldn't place (a misheard or unsung line drags its score down) gets one more try
        # on its own, inside the gap its aligned neighbours leave, so it can't overlap them.
        for index in sorted(set(words) - aligned):
            before = lines[index - 1].get("units") if index - 1 in aligned and not echo(lines[index]) else None
            after = lines[index + 1].get("units") if index + 1 in aligned and not echo(lines[index + 1]) else None
            start = max(lines[index]["t"] - pad, before[-1][2] + LEAD if before else 0.0)
            end = min(line_end(lines, index) + pad, after[0][1] + LEAD if after else float("inf"))
            place([index], start, end)
        return aligned
