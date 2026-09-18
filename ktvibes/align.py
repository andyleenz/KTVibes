"""Per-character/word lyric timing by forced alignment on the separated vocals.

LRCLIB gives line start times. Inside each line, torchaudio's multilingual MMS
aligner finds where each romanized character or word is sung. Lines it cannot
align confidently keep the vocal-energy estimate from lyrics.time_units.
"""
import re
import threading
import unicodedata
from .lyrics import CJK, HANGUL, romanize, split_units

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
        aligned = set()
        for index, line in enumerate(lines):
            if not line["text"] or line.get("exact"):
                continue  # Enhanced LRC already has real word timing.
            units = split_units(line["text"])
            letters = spoken_letters(units)
            words = [w for w in letters if w]
            if not words:
                continue
            start = max(0.0, line["t"] - pad)
            end = lines[index + 1]["t"] if index + 1 < len(lines) else line["t"] + 8
            end = min(end, line["t"] + 15) + pad
            clip = audio[int(start * bundle.sample_rate): int(end * bundle.sample_rate)]
            if len(clip) < bundle.sample_rate // 2:
                continue
            with torch.inference_mode():
                emission, _ = model(clip[None].to(device))
            try:
                spans = aligner(emission[0], tokenizer(words))
            except Exception:
                continue  # Too many letters for the clip length.
            seconds = clip.shape[0] / bundle.sample_rate / emission.shape[1]
            score = sum(s.score for word in spans for s in word) / sum(len(word) for word in spans)
            if score < MIN_SCORE:
                continue
            timed = iter(spans)
            result, last = [], start
            for unit, letter in zip(units, letters):
                if letter:
                    word = next(timed)
                    a, b = start + word[0].start * seconds - LEAD, start + word[-1].end * seconds - LEAD
                    result.append([unit, round(a, 2), round(b, 2)])
                    last = b
                else:
                    result.append([unit, round(last, 2), round(last, 2)])  # punctuation/space
            line["units"] = result
            aligned.add(index)
        return aligned
