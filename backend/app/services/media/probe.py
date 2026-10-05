"""Deterministic media probing with the Python standard library only.

No browser-side decoding and no fabricated metadata: a container that cannot be
parsed returns unknown fields plus an explicit note, never a guess.
"""

from __future__ import annotations

import hashlib
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class ProbeModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class MediaKind(StrEnum):
    image = 'image'
    video = 'video'
    audio = 'audio'
    document = 'document'
    unknown = 'unknown'


IMAGE_MIME = {'image/png', 'image/jpeg', 'image/webp', 'image/gif'}
VIDEO_MIME = {'video/mp4', 'video/quicktime', 'video/webm'}
AUDIO_MIME = {'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg'}
DOCUMENT_MIME = {'application/pdf', 'text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/x-fountain', 'text/vtt'}


class MediaMetadata(ProbeModel):
    kind: MediaKind = MediaKind.unknown
    container: str | None = Field(default=None, max_length=40)
    mime: str = Field(default='application/octet-stream', max_length=120)
    filename: str = Field(default='', max_length=255)
    bytes: int = Field(default=0, ge=0)
    checksum: str = Field(default='', max_length=80)
    duration_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    width: int | None = Field(default=None, ge=1, le=100000)
    height: int | None = Field(default=None, ge=1, le=100000)
    frame_rate: float | None = Field(default=None, gt=0, le=1000)
    frame_count: int | None = Field(default=None, ge=0, le=10_000_000)
    has_video: bool = False
    has_audio: bool = False
    audio_channels: int | None = Field(default=None, ge=1, le=64)
    audio_sample_rate: int | None = Field(default=None, ge=1, le=1000000)
    codecs: list[str] = Field(default_factory=list, max_length=8)
    engine: str = Field(default='stdlib', max_length=60)
    notes: list[str] = Field(default_factory=list, max_length=8)

    @property
    def aspect_ratio(self) -> float | None:
        if self.width and self.height:
            return round(self.width / self.height, 4)
        return None

    @property
    def orientation(self) -> str | None:
        if not self.width or not self.height:
            return None
        if self.width == self.height:
            return 'square'
        return 'landscape' if self.width > self.height else 'portrait'


def detect_kind(mime: str, filename: str) -> MediaKind:
    lowered = mime.lower().split(';')[0].strip()
    if lowered in IMAGE_MIME:
        return MediaKind.image
    if lowered in VIDEO_MIME:
        return MediaKind.video
    if lowered in AUDIO_MIME:
        return MediaKind.audio
    if lowered in DOCUMENT_MIME:
        return MediaKind.document
    suffix = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''
    if suffix in {'png', 'jpg', 'jpeg', 'webp', 'gif'}:
        return MediaKind.image
    if suffix in {'mp4', 'mov', 'm4v', 'webm'}:
        return MediaKind.video
    if suffix in {'wav', 'mp3', 'm4a', 'aac', 'ogg'}:
        return MediaKind.audio
    if suffix in {'pdf', 'txt', 'md', 'fountain', 'srt', 'vtt', 'docx'}:
        return MediaKind.document
    return MediaKind.unknown


def _read_boxes(data: bytes, start: int, end: int, *, depth: int = 0) -> list[tuple[str, int, int]]:
    boxes: list[tuple[str, int, int]] = []
    if depth > 8:
        return boxes
    offset = start
    while offset + 8 <= end:
        size = int.from_bytes(data[offset:offset + 4], 'big')
        box_type = data[offset + 4:offset + 8].decode('latin-1')
        header = 8
        if size == 1:
            if offset + 16 > end:
                break
            size = int.from_bytes(data[offset + 8:offset + 16], 'big')
            header = 16
        elif size == 0:
            size = end - offset
        if size < header or offset + size > end:
            break
        boxes.append((box_type, offset + header, offset + size))
        offset += size
    return boxes


def _find(boxes: list[tuple[str, int, int]], name: str) -> tuple[int, int] | None:
    for box_type, start, end in boxes:
        if box_type == name:
            return start, end
    return None


def _probe_isobmff(data: bytes, metadata: MediaMetadata) -> MediaMetadata:
    roots = _read_boxes(data, 0, len(data))
    moov = _find(roots, 'moov')
    if moov is None:
        metadata.notes.append('The MP4/MOV container has no moov box in the first bytes; streamed files may need the full download.')
        metadata.container = 'isobmff'
        return metadata
    metadata.container = 'isobmff'
    children = _read_boxes(data, moov[0], moov[1], depth=1)
    mvhd = _find(children, 'mvhd')
    if mvhd:
        payload = mvhd[0]
        version = data[payload]
        cursor = payload + 4
        if version == 1:
            timescale = int.from_bytes(data[cursor + 16:cursor + 20], 'big')
            duration = int.from_bytes(data[cursor + 20:cursor + 28], 'big')
        else:
            timescale = int.from_bytes(data[cursor + 8:cursor + 12], 'big')
            duration = int.from_bytes(data[cursor + 12:cursor + 16], 'big')
        if timescale and 0 < duration < 10 ** 12:
            metadata.duration_ms = round(duration / timescale * 1000)
        elif duration >= 10 ** 12:
            metadata.notes.append('The movie header reports an unknown or streamed duration.')
    for box_type, start, end in children:
        if box_type != 'trak':
            continue
        track = _read_boxes(data, start, end, depth=2)
        mdia = _find(track, 'mdia')
        if mdia is None:
            continue
        media_boxes = _read_boxes(data, mdia[0], mdia[1], depth=3)
        handler = ''
        handler_box = _find(media_boxes, 'hdlr')
        if handler_box:
            handler = data[handler_box[0] + 8:handler_box[0] + 12].decode('latin-1')
        mdhd = _find(media_boxes, 'mdhd')
        track_timescale = 0
        if mdhd:
            payload = mdhd[0]
            version = data[payload]
            cursor = payload + 4
            if version == 1:
                track_timescale = int.from_bytes(data[cursor + 16:cursor + 20], 'big')
            else:
                track_timescale = int.from_bytes(data[cursor + 8:cursor + 12], 'big')
        minf = _find(media_boxes, 'minf')
        codec = None
        sample_count = None
        if minf:
            stbl = _find(_read_boxes(data, minf[0], minf[1], depth=4), 'stbl')
            if stbl:
                stbl_boxes = _read_boxes(data, stbl[0], stbl[1], depth=5)
                stsd = _find(stbl_boxes, 'stsd')
                if stsd:
                    payload = stsd[0] + 8
                    if payload + 8 <= len(data):
                        codec = data[payload + 4:payload + 8].decode('latin-1')
                stsz = _find(stbl_boxes, 'stsz')
                if stsz:
                    sample_count = int.from_bytes(data[stsz[0] + 8:stsz[0] + 12], 'big')
                stts = _find(stbl_boxes, 'stts')
                if stts and track_timescale and sample_count:
                    cursor = stts[0] + 4
                    entry_count = int.from_bytes(data[cursor:cursor + 4], 'big')
                    cursor += 4
                    total_duration = 0
                    for _ in range(min(entry_count, 4096)):
                        count = int.from_bytes(data[cursor:cursor + 4], 'big')
                        delta = int.from_bytes(data[cursor + 4:cursor + 8], 'big')
                        total_duration += count * delta
                        cursor += 8
                    if total_duration:
                        metadata.frame_rate = round(sample_count / (total_duration / track_timescale), 3)
        if handler == 'vide':
            metadata.has_video = True
            tkhd = _find(track, 'tkhd')
            if tkhd:
                payload = tkhd[0]
                version = data[payload]
                cursor = payload + 4 + (16 if version == 1 else 8)
                width = int.from_bytes(data[cursor + 76:cursor + 80], 'big')
                height = int.from_bytes(data[cursor + 80:cursor + 84], 'big')
                if width and height:
                    metadata.width = round(width / 65536)
                    metadata.height = round(height / 65536)
            if sample_count:
                metadata.frame_count = sample_count
            if codec:
                metadata.codecs.append(codec.strip())
        elif handler == 'soun':
            metadata.has_audio = True
            if codec:
                metadata.codecs.append(codec.strip())
            if minf:
                stbl = _find(_read_boxes(data, minf[0], minf[1], depth=4), 'stbl')
                if stbl:
                    stsd = _find(_read_boxes(data, stbl[0], stbl[1], depth=5), 'stsd')
                    if stsd:
                        payload = stsd[0] + 16
                        if payload + 8 <= len(data):
                            metadata.audio_channels = int.from_bytes(data[payload + 4:payload + 6], 'big')
                            metadata.audio_sample_rate = int.from_bytes(data[payload + 8:payload + 12], 'big')
    return metadata


def _probe_png(data: bytes, metadata: MediaMetadata) -> MediaMetadata:
    metadata.container = 'png'
    if len(data) < 33 or data[:8] != b'\x89PNG\r\n\x1a\n':
        metadata.notes.append('PNG signature is invalid.')
        return metadata
    metadata.width = int.from_bytes(data[16:20], 'big')
    metadata.height = int.from_bytes(data[20:24], 'big')
    metadata.codecs.append(f'png-{data[24]}-bit-colour-type-{data[25]}')
    return metadata


def _probe_jpeg(data: bytes, metadata: MediaMetadata) -> MediaMetadata:
    metadata.container = 'jpeg'
    index = 2
    while index + 9 < len(data):
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            index += 2
            continue
        if index + 4 > len(data):
            break
        length = int.from_bytes(data[index + 2:index + 4], 'big')
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            metadata.height = int.from_bytes(data[index + 5:index + 7], 'big')
            metadata.width = int.from_bytes(data[index + 7:index + 9], 'big')
            metadata.codecs.append('jpeg')
            break
        if marker == 0xE1 and data[index + 4:index + 10] == b'Exif\x00\x00':
            orientation = _jpeg_orientation(data[index + 10:index + 2 + length])
            if orientation is not None:
                metadata.notes.append(f'EXIF orientation tag {orientation}.')
        index += 2 + length
    if metadata.width is None:
        metadata.notes.append('No JPEG start-of-frame marker was found; dimensions are unknown.')
    return metadata


def _jpeg_orientation(exif: bytes) -> int | None:
    if len(exif) < 14 or exif[:2] not in (b'MM', b'II'):
        return None
    little = exif[:2] == b'II'
    ifd_offset = int.from_bytes(exif[4:8], 'little' if little else 'big')
    if ifd_offset + 2 > len(exif):
        return None
    count = int.from_bytes(exif[ifd_offset:ifd_offset + 2], 'little' if little else 'big')
    for index in range(min(count, 64)):
        entry = ifd_offset + 2 + index * 12
        if entry + 12 > len(exif):
            break
        tag = int.from_bytes(exif[entry:entry + 2], 'little' if little else 'big')
        if tag == 0x0112:
            return int.from_bytes(exif[entry + 8:entry + 10], 'little' if little else 'big')
    return None


def _probe_gif(data: bytes, metadata: MediaMetadata) -> MediaMetadata:
    metadata.container = 'gif'
    metadata.width = int.from_bytes(data[6:8], 'little')
    metadata.height = int.from_bytes(data[8:10], 'little')
    metadata.codecs.append('gif')
    frames = data.count(b'\x2c')
    metadata.frame_count = max(1, frames)
    if frames > 1:
        metadata.notes.append(f'GIF contains about {frames} image descriptors; pacing is not available without decoding.')
    return metadata


def _probe_webp(data: bytes, metadata: MediaMetadata) -> MediaMetadata:
    metadata.container = 'webp'
    if data[12:16] == b'VP8X':
        width = int.from_bytes(data[24:27], 'little') + 1
        height = int.from_bytes(data[27:30], 'little') + 1
        metadata.width, metadata.height = width, height
    elif data[12:16] == b'VP8L':
        bits = int.from_bytes(data[21:25], 'little')
        metadata.width = (bits & 0x3FFF) + 1
        metadata.height = ((bits >> 14) & 0x3FFF) + 1
    elif data[12:16] == b'VP8 ':
        metadata.width = int.from_bytes(data[26:28], 'little') & 0x3FFF
        metadata.height = int.from_bytes(data[28:30], 'little') & 0x3FFF
    metadata.codecs.append('webp')
    return metadata


def _probe_wav(data: bytes, metadata: MediaMetadata) -> MediaMetadata:
    metadata.container = 'wav'
    metadata.has_audio = True
    offset = 12
    while offset + 8 <= len(data):
        chunk = data[offset:offset + 4]
        size = int.from_bytes(data[offset + 4:offset + 8], 'little')
        if chunk == b'fmt ':
            metadata.audio_channels = int.from_bytes(data[offset + 10:offset + 12], 'little')
            metadata.audio_sample_rate = int.from_bytes(data[offset + 12:offset + 16], 'little')
            metadata.codecs.append(f'pcm-{int.from_bytes(data[offset + 22:offset + 24], "little")}-bit')
        if chunk == b'data' and metadata.audio_sample_rate and metadata.audio_channels:
            block = max(1, metadata.audio_sample_rate * metadata.audio_channels * 2)
            metadata.duration_ms = round(size / block * 1000)
        offset += 8 + size + (size % 2)
    return metadata


MP3_BITRATES = {
    1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
}
MP3_RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def _probe_mp3(data: bytes, metadata: MediaMetadata) -> MediaMetadata:
    metadata.container = 'mp3'
    metadata.has_audio = True
    metadata.codecs.append('mpeg-audio')
    index = 0
    while index + 4 < len(data):
        if data[index] == 0xFF and (data[index + 1] & 0xE0) == 0xE0:
            header = data[index:index + 4]
            version_bits = (header[1] >> 3) & 0x03
            bitrate_index = (header[2] >> 4) & 0x0F
            rate_index = (header[2] >> 2) & 0x03
            rate_table = MP3_RATES.get(version_bits)
            bitrate_table = MP3_BITRATES.get(2 if version_bits >= 2 else 1)
            if rate_table and bitrate_table and rate_index < len(rate_table) and bitrate_index < len(bitrate_table):
                sample_rate = rate_table[rate_index]
                bitrate = bitrate_table[bitrate_index] * 1000
                metadata.audio_sample_rate = sample_rate
                metadata.audio_channels = 1 if (header[3] >> 6) & 0x03 == 3 else 2
                if bitrate:
                    metadata.duration_ms = round(len(data) * 8 / bitrate * 1000)
                    metadata.notes.append('MP3 duration is estimated from the first frame bitrate, not from a decoded sample count.')
                break
        index += 1
    if metadata.audio_sample_rate is None:
        metadata.notes.append('No MPEG audio frame header was found; the file may be damaged or use another codec.')
    return metadata


def probe(data: bytes, *, filename: str, mime: str) -> MediaMetadata:
    metadata = MediaMetadata(
        kind=detect_kind(mime, filename), mime=(mime or 'application/octet-stream')[:120], filename=filename[:255],
        bytes=len(data), checksum=hashlib.sha256(data).hexdigest()[:32],
    )
    if not data:
        metadata.notes.append('The file is empty, so nothing can be analysed.')
        return metadata
    try:
        if data[:8] == b'\x89PNG\r\n\x1a\n':
            return _probe_png(data, metadata)
        if data[:2] == b'\xff\xd8':
            return _probe_jpeg(data, metadata)
        if data[:6] in {b'GIF87a', b'GIF89a'}:
            return _probe_gif(data, metadata)
        if data[:4] == b'RIFF' and data[8:12] == b'WAVE':
            return _probe_wav(data, metadata)
        if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            return _probe_webp(data, metadata)
        if data[4:8] in {b'ftyp', b'moov', b'free', b'mdat', b'skip', b'wide'}:
            return _probe_isobmff(data, metadata)
        if data[:2] == b'\xff\xfb' or data[:2] == b'\xff\xf3' or data[:2] == b'\xff\xf2' or data[:3] == b'ID3':
            return _probe_mp3(data, metadata)
        if data[:4] == b'%PDF':
            metadata.container = 'pdf'
            metadata.notes.append('PDF text is extracted best-effort; scanned pages have no text layer.')
            return metadata
        if data[:4] == b'PK\x03\x04':
            metadata.container = 'zip-container'
            metadata.notes.append('Office/OpenDocument container detected; document parsing is applied separately.')
            return metadata
        if data[:4] == b'OggS':
            metadata.container = 'ogg'
            metadata.has_audio = True
            metadata.codecs.append('ogg')
            metadata.notes.append('Ogg duration is not derived without a decoder; the audio stream is passed to the provider as-is.')
            return metadata
    except (IndexError, ValueError) as exc:
        metadata.notes.append(f'Container parsing stopped early ({type(exc).__name__}); some metadata is unavailable.')
        return metadata
    metadata.notes.append('The container is not recognised, so only file size and checksum are known.')
    return metadata
