"""Representative frame selection and extraction.

Frame *selection* is deterministic and always available. Frame *extraction*
needs a real decoder: FFmpeg when the binary is configured or on PATH, and an
explicit unavailable state otherwise. No pixels are ever invented.
"""

from __future__ import annotations

import asyncio
import base64
import shutil
import time
import tempfile
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.services.media.audio import AudioEvidence
from app.services.media.probe import MediaMetadata

MAX_FRAMES = 12


class FrameModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class FramePlanItem(FrameModel):
    index: int = Field(ge=0, le=64)
    timecode_ms: int = Field(ge=0, le=9007199254740991)
    reason: str = Field(pattern=r'^(first|last|uniform|boundary|audio_onset)$', max_length=20)
    label: str = Field(default='', max_length=120)


class FramePlan(FrameModel):
    items: list[FramePlanItem] = Field(default_factory=list, max_length=64)
    strategy: str = Field(default='temporal sampling', max_length=200)
    boundary_source: str = Field(default='uniform', max_length=60)
    limitations: list[str] = Field(default_factory=list, max_length=6)

    @property
    def timecodes(self) -> list[int]:
        return [item.timecode_ms for item in self.items]


class ExtractedFrame(FrameModel):
    index: int = Field(ge=0, le=64)
    timecode_ms: int = Field(ge=0, le=9007199254740991)
    media_type: str = Field(default='image/jpeg', max_length=40)
    data_base64: str = Field(min_length=8, max_length=8_000_000)
    label: str = Field(default='', max_length=120)
    bytes: int = Field(default=0, ge=0)


def plan_frames(metadata: MediaMetadata, *, audio: AudioEvidence | None = None, max_frames: int = MAX_FRAMES) -> FramePlan:
    """Deterministic representative frames: first, last, audio onsets, then uniform fill."""

    limitations: list[str] = []
    if metadata.duration_ms is None or metadata.duration_ms <= 0:
        limitations.append('Duration is unknown, so representative frames cannot be placed in time yet.')
        return FramePlan(items=[], strategy='unavailable without duration', boundary_source='unknown', limitations=limitations)
    duration = metadata.duration_ms
    limit = max(4, min(max_frames, 24))
    items: dict[int, FramePlanItem] = {}

    items[0] = FramePlanItem(index=0, timecode_ms=0, reason='first', label='first frame')
    items[1] = FramePlanItem(index=1, timecode_ms=max(0, duration - 100), reason='last', label='final frame')
    boundary_source = 'uniform'
    if audio is not None and audio.onsets and audio.duration_ms:
        boundary_source = 'audio_energy'
        for segment in audio.segments[:limit]:
            if segment.kind in {'speech_like', 'sustained_level'} and len(items) < limit - 2:
                items[len(items)] = FramePlanItem(index=len(items), timecode_ms=segment.start_ms, reason='audio_onset', label=f'audio activity at {segment.start_ms} ms')
    remaining = limit - len(items)
    if remaining > 0:
        slots = remaining + 1
        for step in range(1, slots):
            timecode = round(duration * step / slots)
            if all(abs(timecode - item.timecode_ms) > max(250, duration // 40) for item in items.values()) or len(items) < 4:
                items[len(items)] = FramePlanItem(index=len(items), timecode_ms=timecode, reason='uniform', label=f'temporal sample at {timecode} ms')
    ordered = sorted(items.values(), key=lambda item: item.timecode_ms)
    for index, item in enumerate(ordered):
        ordered[index] = item.model_copy(update={'index': index})
    if boundary_source == 'uniform':
        limitations.append('No audio onsets were available, so candidate boundaries come from temporal sampling only.')
    return FramePlan(
        items=ordered,
        strategy='first and final frames, audio-activity boundaries, then even temporal fill',
        boundary_source=boundary_source,
        limitations=limitations,
    )


class FrameExtractor(Protocol):
    name: str

    def available(self) -> bool: ...

    def reason(self) -> str: ...

    async def extract(self, data: bytes, plan: FramePlan, *, mime: str, filename: str) -> list[ExtractedFrame]: ...


class UnavailableFrameExtractor:
    """Explicit absence of a decoder. Downstream analysis degrades to metadata instead of guessing."""

    name = 'unavailable'

    def __init__(self, reason: str = 'No video decoder (FFmpeg) is configured on this server.') -> None:
        self._reason = reason

    def available(self) -> bool:
        return False

    def reason(self) -> str:
        return self._reason

    async def extract(self, data: bytes, plan: FramePlan, *, mime: str, filename: str) -> list[ExtractedFrame]:
        raise RuntimeError(self._reason)


class FfmpegFrameExtractor:
    name = 'ffmpeg'

    def __init__(self, *, ffmpeg_path: str | None = None, timeout_seconds: float = 120) -> None:
        self.ffmpeg_path = ffmpeg_path or shutil.which('ffmpeg')
        if not self.ffmpeg_path and ffmpeg_path is None:
            try:
                from imageio_ffmpeg import get_ffmpeg_exe
                self.ffmpeg_path = get_ffmpeg_exe()
            except (ImportError, RuntimeError, OSError):
                self.ffmpeg_path = None
        self.timeout_seconds = timeout_seconds

    def available(self) -> bool:
        return bool(self.ffmpeg_path) and Path(str(self.ffmpeg_path)).exists()

    def reason(self) -> str:
        if self.available():
            return f'FFmpeg frame extraction is available at {self.ffmpeg_path}.'
        return 'FFmpeg is not installed on this server, so frame pixels cannot be decoded.'

    async def extract(self, data: bytes, plan: FramePlan, *, mime: str, filename: str) -> list[ExtractedFrame]:
        if not self.available() or not plan.items:
            raise RuntimeError(self.reason())
        frames: list[ExtractedFrame] = []
        with tempfile.TemporaryDirectory(prefix='tonde-frames-') as directory:
            suffix = Path(filename).suffix or '.mp4'
            source = Path(directory) / f'source{suffix}'
            source.write_bytes(data)
            deadline = time.monotonic() + self.timeout_seconds
            for item in plan.items:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                target = Path(directory) / f'frame-{item.index:03d}.jpg'
                process = await asyncio.create_subprocess_exec(
                    str(self.ffmpeg_path), '-hide_banner', '-loglevel', 'error', '-ss', f'{item.timecode_ms / 1000:.3f}',
                    '-i', str(source), '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '4', str(target),
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
                )
                try:
                    await asyncio.wait_for(process.communicate(), timeout=remaining)
                except (TimeoutError, asyncio.CancelledError) as exc:
                    process.kill()
                    await process.communicate()
                    if isinstance(exc, asyncio.CancelledError):
                        raise
                    break
                if process.returncode != 0 or not target.exists():
                    continue
                payload = target.read_bytes()
                if not payload:
                    continue
                frames.append(ExtractedFrame(
                    index=item.index, timecode_ms=item.timecode_ms, media_type='image/jpeg',
                    data_base64=base64.b64encode(payload).decode('ascii'), label=item.label or f'frame at {item.timecode_ms} ms',
                    bytes=len(payload),
                ))
        return frames


def build_frame_extractor(ffmpeg_path: str | None = None) -> FrameExtractor:
    extractor = FfmpegFrameExtractor(ffmpeg_path=ffmpeg_path)
    if extractor.available():
        return extractor
    return UnavailableFrameExtractor()
