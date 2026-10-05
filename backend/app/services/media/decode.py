"""Real, dependency-free pixel analysis for PNG images plus deterministic composition evidence.

Only PNG is decoded (zlib is in the standard library). For other formats the
caller receives an explicit ``None`` with a reason, never invented visual facts.
"""

from __future__ import annotations

import zlib

from pydantic import BaseModel, ConfigDict, Field

from app.domain.analysis import QualitativeConfidence


class PixelModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class PaletteColor(PixelModel):
    hex: str = Field(min_length=4, max_length=9)
    share: float = Field(ge=0, le=1)


class PixelStats(PixelModel):
    """Observable image properties. No camera model, ISO or focal length is claimed."""

    width: int = Field(ge=1, le=100000)
    height: int = Field(ge=1, le=100000)
    sampled_pixels: int = Field(ge=0)
    aspect_ratio: float = Field(gt=0)
    orientation: str = Field(max_length=20)
    palette: list[PaletteColor] = Field(default_factory=list, max_length=8)
    mean_luminance: float = Field(ge=0, le=1)
    contrast: float = Field(ge=0, le=1)
    saturation: float = Field(ge=0, le=1)
    temperature: str = Field(default='neutral', max_length=20)
    temperature_score: float = Field(default=0, ge=-1, le=1)
    highlight_share: float = Field(ge=0, le=1)
    shadow_share: float = Field(ge=0, le=1)
    texture: float = Field(ge=0, le=1)
    edge_density: float = Field(ge=0, le=1)
    symmetry: float = Field(ge=0, le=1)
    subject_region: str = Field(default='unknown', max_length=40)
    background_separation: float = Field(ge=-1, le=1)
    confidence: QualitativeConfidence = QualitativeConfidence.medium
    limitations: list[str] = Field(default_factory=list, max_length=8)


def _paeth(left: int, above: int, upper_left: int) -> int:
    estimate = left + above - upper_left
    distance_left = abs(estimate - left)
    distance_above = abs(estimate - above)
    distance_upper = abs(estimate - upper_left)
    if distance_left <= distance_above and distance_left <= distance_upper:
        return left
    if distance_above <= distance_upper:
        return above
    return upper_left


def decode_png(data: bytes, *, max_side: int = 192) -> tuple[int, int, list[tuple[int, int, int]]] | None:
    """Decode a non-interlaced 8/16-bit PNG into sampled RGB pixels."""

    if data[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    offset = 8
    width = height = bit_depth = color_type = interlace = 0
    palette: list[tuple[int, int, int]] = []
    compressed = bytearray()
    while offset + 8 <= len(data):
        length = int.from_bytes(data[offset:offset + 4], 'big')
        chunk_type = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        if chunk_type == b'IHDR':
            width = int.from_bytes(payload[0:4], 'big')
            height = int.from_bytes(payload[4:8], 'big')
            bit_depth = payload[8]
            color_type = payload[9]
            interlace = payload[12]
        elif chunk_type == b'PLTE':
            palette = [(payload[i], payload[i + 1], payload[i + 2]) for i in range(0, len(payload) - 2, 3)]
        elif chunk_type == b'IDAT':
            compressed.extend(payload)
        elif chunk_type == b'IEND':
            break
        offset += 12 + length
    if not width or not height or interlace != 0 or bit_depth not in (8, 16):
        return None
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color_type)
    if channels is None or (color_type == 3 and not palette):
        return None
    try:
        raw = zlib.decompress(bytes(compressed))
    except zlib.error:
        return None
    sample_bytes = channels * (bit_depth // 8)
    stride = width * sample_bytes
    if len(raw) < stride * height:
        return None
    previous = bytearray(stride)
    step = max(1, max(width, height) // max(1, max_side))
    pixels: list[tuple[int, int, int]] = []
    for row in range(height):
        start = row * (stride + 1)
        if start + 1 + stride > len(raw):
            break
        filter_type = raw[start]
        line = bytearray(raw[start + 1:start + 1 + stride])
        if filter_type == 1:
            for index in range(sample_bytes, stride):
                line[index] = (line[index] + line[index - sample_bytes]) & 0xFF
        elif filter_type == 2:
            for index in range(stride):
                line[index] = (line[index] + previous[index]) & 0xFF
        elif filter_type == 3:
            for index in range(stride):
                left = line[index - sample_bytes] if index >= sample_bytes else 0
                line[index] = (line[index] + ((left + previous[index]) >> 1)) & 0xFF
        elif filter_type == 4:
            for index in range(stride):
                left = line[index - sample_bytes] if index >= sample_bytes else 0
                upper_left = previous[index - sample_bytes] if index >= sample_bytes else 0
                line[index] = (line[index] + _paeth(left, previous[index], upper_left)) & 0xFF
        previous = line
        if row % step:
            continue
        for column in range(0, width, step):
            base = column * sample_bytes
            if color_type == 3:
                index = line[base]
                pixels.append(palette[index] if index < len(palette) else (0, 0, 0))
                continue
            if bit_depth == 16:
                values = [line[base + channel * 2] for channel in range(channels)]
            else:
                values = [line[base + channel] for channel in range(channels)]
            if color_type == 0:
                grey = values[0]
                pixels.append((grey, grey, grey))
            elif color_type == 4:
                grey = values[0]
                pixels.append((grey, grey, grey))
            else:
                pixels.append((values[0], values[1], values[2]))
    if not pixels:
        return None
    return width, height, pixels


def luminance(pixel: tuple[int, int, int]) -> float:
    red, green, blue = pixel
    return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255


def _quantize(pixel: tuple[int, int, int]) -> tuple[int, int, int]:
    return (pixel[0] >> 4 << 4, pixel[1] >> 4 << 4, pixel[2] >> 4 << 4)


def image_evidence(width: int, height: int, pixels: list[tuple[int, int, int]], *, sampling_step: int | None = None) -> PixelStats:
    """Compute palette, exposure, contrast, texture and composition evidence from real pixels."""

    total = len(pixels)
    counts: dict[tuple[int, int, int], int] = {}
    luminance_values: list[float] = []
    saturation_values: list[float] = []
    warmth = 0.0
    for pixel in pixels:
        counts[_quantize(pixel)] = counts.get(_quantize(pixel), 0) + 1
        luminance_values.append(luminance(pixel))
        red, green, blue = pixel
        high = max(pixel)
        low = min(pixel)
        saturation_values.append(0.0 if high == 0 else (high - low) / high)
        warmth += (red - blue) / 255
    mean_luminance = sum(luminance_values) / total
    variance = sum((value - mean_luminance) ** 2 for value in luminance_values) / total
    contrast = min(1.0, variance ** 0.5 * 2)
    saturation = sum(saturation_values) / total
    temperature_score = max(-1.0, min(1.0, warmth / total * 2))
    ordered = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    palette = [
        PaletteColor(hex='#{:02x}{:02x}{:02x}'.format(*color), share=round(count / total, 4))
        for color, count in ordered[:6]
    ]
    highlight_share = sum(1 for value in luminance_values if value > 0.85) / total
    shadow_share = sum(1 for value in luminance_values if value < 0.15) / total
    columns = max(1, round(len(pixels) ** 0.5))
    gradient_total = 0.0
    edge_hits = 0
    comparisons = 0
    usable = min(columns, len(pixels) // max(1, columns))
    for row in range(usable - 1):
        for column in range(columns - 1):
            index = row * columns + column
            if index + columns + 1 >= len(pixels):
                break
            here = luminance_values[index]
            right = luminance_values[index + 1]
            below = luminance_values[index + columns]
            delta = (abs(here - right) + abs(here - below)) / 2
            gradient_total += delta
            if delta > 0.12:
                edge_hits += 1
            comparisons += 1
    texture = min(1.0, gradient_total / comparisons * 4) if comparisons else 0.0
    edge_density = edge_hits / comparisons if comparisons else 0.0
    rows = max(1, len(pixels) // columns)
    symmetry_rows = min(rows, 24)
    symmetry_total = 0.0
    symmetry_comparisons = 0
    for row in range(symmetry_rows):
        base = row * columns
        for column in range(columns // 2):
            left = luminance_values[base + column]
            right = luminance_values[base + columns - 1 - column]
            symmetry_total += abs(left - right)
            symmetry_comparisons += 1
    symmetry = max(0.0, 1 - (symmetry_total / symmetry_comparisons * 2)) if symmetry_comparisons else 0.0
    grid: list[tuple[str, float]] = []
    for row in range(3):
        for column in range(3):
            local: list[float] = []
            for index in range(len(pixels)):
                source_row = index // columns
                source_column = index % columns
                if source_row * 3 // max(1, rows) == row and source_column * 3 // columns == column:
                    local.append(luminance_values[index])
            if local:
                mean = sum(local) / len(local)
                spread = (sum((value - mean) ** 2 for value in local) / len(local)) ** 0.5
                grid.append((f'{"top" if row == 0 else "centre" if row == 1 else "bottom"}-{"left" if column == 0 else "centre" if column == 1 else "right"}', spread))
    subject_region = max(grid, key=lambda item: item[1])[0] if grid else 'unknown'
    border: list[float] = []
    centre: list[float] = []
    for index, value in enumerate(luminance_values):
        row = index // columns
        column = index % columns
        if row in (0, rows - 1) or column in (0, columns - 1):
            border.append(value)
        elif rows // 4 <= row <= rows - rows // 4 and columns // 4 <= column <= columns - columns // 4:
            centre.append(value)
    separation = 0.0
    if border and centre:
        separation = round((sum(centre) / len(centre)) - (sum(border) / len(border)), 4)
    limitations = ['Focal length, aperture, ISO and shutter are not inferred from appearance.']
    if sampling_step:
        limitations.append(f'Pixels are sampled every {sampling_step} pixels for performance.')
    return PixelStats(
        width=width, height=height, sampled_pixels=total, aspect_ratio=round(width / height, 4),
        orientation='square' if width == height else ('landscape' if width > height else 'portrait'),
        palette=palette, mean_luminance=round(mean_luminance, 4), contrast=round(contrast, 4),
        saturation=round(saturation, 4),
        temperature='warm' if temperature_score > 0.06 else ('cool' if temperature_score < -0.06 else 'neutral'),
        temperature_score=round(temperature_score, 4), highlight_share=round(highlight_share, 4),
        shadow_share=round(shadow_share, 4), texture=round(texture, 4), edge_density=round(edge_density, 4),
        symmetry=round(symmetry, 4), subject_region=subject_region, background_separation=separation,
        limitations=limitations,
    )
