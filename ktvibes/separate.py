"""One lazily loaded model on CUDA, Apple MPS, or CPU. Run: uv run python -m ktvibes.separate AUDIO OUTPUT_DIR"""
from pathlib import Path
import sys
import threading
import time
import torch
from demucs.apply import apply_model
from demucs.audio import AudioFile
from demucs.pretrained import get_model
from . import stems as stem_files

_model = None
_lock = threading.Lock()

def _device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"

def separate(source: Path, destination: Path) -> tuple[float, float]:
    """Write vocals.opus and no_vocals.opus; returns (seconds taken, playback gain)."""
    global _model
    started = time.monotonic()
    with _lock:
        if _model is None:
            _model = get_model("htdemucs").to(_device()).eval()
        audio = AudioFile(str(source)).read(streams=0, samplerate=_model.samplerate, channels=_model.audio_channels)
        reference = audio.mean(0)
        mean, std = reference.mean(), reference.std().clamp_min(1e-8)
        with torch.inference_mode():
            stems = apply_model(_model, ((audio - mean) / std)[None], device=_device(), shifts=1, split=True, overlap=0.25, progress=False)[0].cpu()
        stems = stems * std + mean
        index = _model.sources.index("vocals")
        vocals = stems[index]
        instrumental = sum(stems[i] for i in range(len(stems)) if i != index)
        destination.mkdir(parents=True, exist_ok=True)
        gain = stem_files.write(destination, vocals.T.numpy(), instrumental.T.numpy(), _model.samplerate)
    return time.monotonic() - started, gain

if __name__ == "__main__":
    seconds, gain = separate(Path(sys.argv[1]), Path(sys.argv[2]))
    print(f"Separation: {seconds:.1f}s, playback gain {gain:.3f}")
