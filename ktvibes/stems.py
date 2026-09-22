"""Separated tracks on disk: lossless 24-bit FLAC, about half the size of float WAV.

Demucs stems can peak above full scale, which FLAC's integer samples cannot hold, so
both stems are scaled down together and meta.json keeps the gain that restores the level.
"""
from pathlib import Path
import numpy as np
import soundfile as sf

NAMES = ("vocals", "no_vocals")
HEADROOM = 0.99

def ready(folder: Path) -> bool:
    return all((folder / f"{name}.flac").is_file() for name in NAMES)

def write(folder: Path, vocals, instrumental, rate: int) -> float:
    """Save (frames, channels) float stems; returns the playback gain that undoes the scaling."""
    peak = max(float(np.abs(vocals).max(initial=0)), float(np.abs(instrumental).max(initial=0)))
    scale = min(1.0, HEADROOM / peak) if peak else 1.0
    for name, data in zip(NAMES, (vocals, instrumental)):
        temporary = folder / f"{name}.tmp.flac"
        sf.write(temporary, data * scale, rate, subtype="PCM_24", format="FLAC")
        temporary.replace(folder / f"{name}.flac")
    return 1 / scale

def migrate(folder: Path) -> float | None:
    """Convert float WAV stems from older versions; None when there are none to convert."""
    wavs = [folder / f"{name}.wav" for name in NAMES]
    if not all(path.is_file() for path in wavs):
        return None
    (vocals, rate), (instrumental, _) = (sf.read(path, dtype="float32") for path in wavs)
    gain = write(folder, vocals, instrumental, rate)
    for path in wavs:
        path.unlink()
    return gain
