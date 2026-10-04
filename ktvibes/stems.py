"""Separated tracks on disk: Ogg Opus at about 160 kbit/s, about 4 MB per stem for a 3-minute song.

Older versions stored float WAV, then 24-bit FLAC (about 70 MB a song); both convert on the
next play. Demucs stems can peak above full scale, so both stems are scaled down together and
meta.json keeps the gain that restores the level.
"""
from pathlib import Path
import numpy as np
import soundfile as sf

NAMES = ("vocals", "no_vocals")
HEADROOM = 0.99
RATE = 48000  # the only rate Opus encodes
QUALITY = 0.7  # libsndfile compression level: 0.7 is about 160 kbit/s stereo
OLD = ("flac", "wav")

def path(folder: Path, name: str) -> Path | None:
    """The stem file to play or read: Opus, or an older format not yet converted; None if missing."""
    for ext in ("opus", *OLD):
        if (candidate := folder / f"{name}.{ext}").is_file():
            return candidate
    return None

def ready(folder: Path) -> bool:
    return all((folder / f"{name}.opus").is_file() for name in NAMES)

def prepared(folder: Path) -> bool:
    """Stems exist in any format (older ones convert when the song is next queued)."""
    return all(path(folder, name) for name in NAMES)

def resample(data, rate: int):
    if rate == RATE:
        return data
    import torch
    import torchaudio.functional as F
    return F.resample(torch.from_numpy(np.ascontiguousarray(data.T)), rate, RATE).T.numpy()

def write(folder: Path, vocals, instrumental, rate: int) -> float:
    """Save (frames, channels) float stems; returns the playback gain that undoes the scaling."""
    peak = max(float(np.abs(vocals).max(initial=0)), float(np.abs(instrumental).max(initial=0)))
    scale = min(1.0, HEADROOM / peak) if peak else 1.0
    for name, data in zip(NAMES, (vocals, instrumental)):
        temporary = folder / f"{name}.tmp.opus"
        sf.write(temporary, resample(data * scale, rate), RATE, format="OGG", subtype="OPUS", compression_level=QUALITY)
        temporary.replace(folder / f"{name}.opus")
    return 1 / scale

def migrate(folder: Path, gain: float | None) -> float | None:
    """Convert stems from older versions; returns the new gain, or None when there are none to convert.

    FLAC stems were already scaled by `gain`, so their level is restored before rescaling.
    """
    for ext in OLD:
        old = [folder / f"{name}.{ext}" for name in NAMES]
        if all(p.is_file() for p in old):
            (vocals, rate), (instrumental, _) = (sf.read(p, dtype="float32") for p in old)
            level = (gain or 1.0) if ext == "flac" else 1.0
            new_gain = write(folder, vocals * level, instrumental * level, rate)
            for p in old:
                p.unlink()
            return new_gain
    return None
