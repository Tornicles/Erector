"""Deterministic audio evidence from uncompressed PCM audio.

Cadence, pauses, dynamics and an apparent pitch range are measured from real
samples. Nobody is identified by voice, and no transcript is invented.
"""

from __future__ import annotations

import math

from pydantic import BaseModel, ConfigDict, Field

WINDOW_MS = 20
MIN_PAUSE_MS = 260


class AudioModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class AudioSegment(AudioModel):
    index: int = Field(ge=0, le=100000)
    start_ms: int = Field(ge=0, le=9007199254740991)
    end_ms: int = Field(ge=0, le=9007199254740991)
    kind: str = Field(pattern=r'^(speech_like|silence|sustained_level|unknown)$', max_length=20)
    rms_db: float = Field(ge=-160, le=6)
    peak_db: float = Field(ge=-160, le=6)


class AudioEvidence(AudioModel):
    duration_ms: int = Field(ge=0, le=9007199254740991)
    sample_rate: int = Field(ge=1, le=1000000)
    channels: int = Field(ge=1, le=64)
    peak_db: float = Field(ge=-160, le=6)
    mean_db: float = Field(ge=-160, le=6)
    dynamic_range_db: float = Field(ge=0, le=160)
    silence_ratio: float = Field(ge=0, le=1)
    pauses: list[AudioSegment] = Field(default_factory=list, max_length=400)
    segments: list[AudioSegment] = Field(default_factory=list, max_length=2000)
    onsets: int = Field(default=0, ge=0, le=100000)
    onsets_per_minute: float = Field(default=0, ge=0, le=10000)
    cadence: str = Field(default='unmeasured', max_length=40)
    apparent_pitch_low_hz: float | None = Field(default=None, ge=0, le=20000)
    apparent_pitch_high_hz: float | None = Field(default=None, ge=0, le=20000)
    energy_contour: list[float] = Field(default_factory=list, max_length=600)
    limitations: list[str] = Field(default_factory=list, max_length=8)


def decode_wav(data: bytes) -> tuple[int, int, list[float]] | None:
    """Decode uncompressed PCM WAV (8/16/24/32-bit) into mono float samples in [-1, 1]."""

    if data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        return None
    offset = 12
    fmt: dict[str, int] = {}
    frames = b''
    while offset + 8 <= len(data):
        chunk = data[offset:offset + 4]
        size = int.from_bytes(data[offset + 4:offset + 8], 'little')
        payload = data[offset + 8:offset + 8 + size]
        if chunk == b'fmt ':
            fmt = {
                'format': int.from_bytes(payload[0:2], 'little'),
                'channels': int.from_bytes(payload[2:4], 'little'),
                'sample_rate': int.from_bytes(payload[4:8], 'little'),
                'bits': int.from_bytes(payload[14:16], 'little'),
            }
        elif chunk == b'data':
            frames = payload
        offset += 8 + size + (size % 2)
    if not fmt or not frames or fmt.get('format') not in (1, 3):
        return None
    channels = max(1, fmt.get('channels', 1))
    sample_rate = max(1, fmt.get('sample_rate', 8000))
    bits = fmt.get('bits', 16)
    width = max(1, bits // 8)
    frame_count = len(frames) // (width * channels)
    samples: list[float] = []
    for index in range(frame_count):
        total = 0.0
        for channel in range(channels):
            start = (index * channels + channel) * width
            raw = frames[start:start + width]
            if bits == 8:
                value = (raw[0] - 128) / 128
            elif bits == 16:
                value = int.from_bytes(raw, 'little', signed=True) / 32768
            elif bits == 24:
                value = int.from_bytes(raw + (b'\xff' if raw[2] & 0x80 else b'\x00'), 'little', signed=True) / 8388608
            else:
                value = int.from_bytes(raw[:4], 'little', signed=True) / 2147483648
            total += value
        samples.append(total / channels)
    return sample_rate, channels, samples


def _db(value: float) -> float:
    return -160.0 if value <= 1e-7 else round(20 * math.log10(value), 2)


def audio_evidence(sample_rate: int, channels: int, samples: list[float]) -> AudioEvidence:
    window = max(1, sample_rate * WINDOW_MS // 1000)
    rms_values: list[float] = []
    peak_values: list[float] = []
    zero_crossings: list[int] = []
    for start in range(0, len(samples) - window + 1, window):
        chunk = samples[start:start + window]
        energy = math.sqrt(sum(value * value for value in chunk) / len(chunk))
        rms_values.append(energy)
        peak_values.append(max(abs(value) for value in chunk))
        crossings = sum(1 for index in range(1, len(chunk)) if (chunk[index - 1] < 0) != (chunk[index] < 0))
        zero_crossings.append(crossings)
    if not rms_values:
        return AudioEvidence(duration_ms=0, sample_rate=sample_rate, channels=channels, peak_db=-160, mean_db=-160, dynamic_range_db=0, silence_ratio=1,
                             limitations=['No complete analysis window was found in this audio.'])
    peak = max(peak_values)
    mean = sum(rms_values) / len(rms_values)
    floor = sorted(rms_values)[max(0, len(rms_values) // 20)]
    threshold = max(floor * 2.0, 0.003)
    voiced = [index for index, value in enumerate(rms_values) if value >= threshold]
    onsets = sum(1 for index in range(1, len(rms_values)) if rms_values[index - 1] < threshold <= rms_values[index])
    duration_ms = round(len(samples) / sample_rate * 1000)
    minutes = max(duration_ms / 60000, 1 / 60)
    segments: list[AudioSegment] = []
    pauses: list[AudioSegment] = []
    index = 0
    while index < len(rms_values):
        above = rms_values[index] >= threshold
        run_start = index
        while index < len(rms_values) and (rms_values[index] >= threshold) == above:
            index += 1
        start_ms = run_start * WINDOW_MS
        end_ms = min(duration_ms, index * WINDOW_MS)
        window_rms = max(rms_values[run_start:index])
        window_peak = max(peak_values[run_start:index])
        if above:
            kind = 'speech_like' if zero_crossings[run_start] > 2 else 'sustained_level'
            segments.append(AudioSegment(index=len(segments), start_ms=start_ms, end_ms=end_ms, kind=kind, rms_db=_db(window_rms), peak_db=_db(window_peak)))
        else:
            segment = AudioSegment(index=len(pauses), start_ms=start_ms, end_ms=end_ms, kind='silence', rms_db=_db(window_rms), peak_db=_db(window_peak))
            if end_ms - start_ms >= MIN_PAUSE_MS:
                pauses.append(segment)
            segments.append(AudioSegment(index=len(segments), start_ms=start_ms, end_ms=end_ms, kind='silence', rms_db=segment.rms_db, peak_db=segment.peak_db))
    pitch_low: float | None = None
    pitch_high: float | None = None
    if voiced:
        estimates: list[float] = []
        for index in voiced:
            if zero_crossings[index] > 0:
                estimates.append(zero_crossings[index] * sample_rate / (2 * window))
        if len(estimates) >= 4:
            estimates.sort()
            pitch_low = round(estimates[max(0, len(estimates) // 10)], 1)
            pitch_high = round(estimates[min(len(estimates) - 1, len(estimates) * 9 // 10)], 1)
    per_minute = round(onsets / minutes, 2)
    cadence = 'brisk' if per_minute >= 220 else ('measured' if per_minute >= 90 else 'slow')
    contour = [round(value, 4) for value in rms_values[:600]]
    return AudioEvidence(
        duration_ms=duration_ms, sample_rate=sample_rate, channels=channels, peak_db=_db(peak), mean_db=_db(mean),
        dynamic_range_db=round(max(0.0, _db(peak) - _db(floor)), 2),
        silence_ratio=round(1 - len(voiced) / len(rms_values), 4), pauses=pauses[:400], segments=segments[:2000],
        onsets=onsets, onsets_per_minute=per_minute, cadence=cadence,
        apparent_pitch_low_hz=pitch_low, apparent_pitch_high_hz=pitch_high, energy_contour=contour,
        limitations=[
            'Energy, pauses and cadence are measured from samples; emotion and delivery are not inferred from them.',
            'Apparent pitch is a zero-crossing estimate for direction only, not a musical measurement.',
            'Nobody is identified by voice.',
        ],
    )


def analyse_audio(data: bytes, mime: str) -> AudioEvidence | None:
    if mime.lower() in {'audio/wav', 'audio/x-wav'} or data[:4] == b'RIFF' and data[8:12] == b'WAVE':
        decoded = decode_wav(data)
        if decoded is None:
            return None
        return audio_evidence(*decoded)
    return None
