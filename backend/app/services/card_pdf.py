"""Card-native PDF rendering: the Studio Card on a landscape sheet.

Every creator-facing download is a PDF that looks like the TONDE Card itself -- not a rewritten
report. This module renders shared card models (assembled in `card_download.py` from the pinned
export content) onto US Letter landscape pages with the standard library only:

* real DOM-free vector PDF 1.4: filled panels, rules, Helvetica text in Flate streams, so the
  project's own `extract_pdf` recovers the text layer (selectable text, proven by round trip);
* one Card starts on a new page and continues onto further pages instead of shrinking;
* interactive Studio chrome (buttons, inputs, chat) never enters the model, so it cannot leak in;
* videos and missing visuals become their representative intent text, never blank decoration;
* JPEG result/storyboard frames embed as DCTDecode images when the export carries their bytes.

Two styles share the same hierarchy and layout: TONDE Standard (dark) and print-friendly (light).
"""

from __future__ import annotations

import io
import zlib
from dataclasses import dataclass, field

PAGE_WIDTH = 792.0
PAGE_HEIGHT = 612.0
MARGIN = 36.0
CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
LEADING = 12.0
SMALL_LEADING = 10.5

STANDARD = {
    'page': (0.024, 0.063, 0.051),
    'panel': (0.043, 0.086, 0.070),
    'panel_edge': (0.208, 0.322, 0.278),
    'ink': (0.957, 0.969, 0.961),
    'muted': (0.569, 0.643, 0.608),
    'accent': (0.553, 1.0, 0.678),
    'rule': (0.125, 0.208, 0.176),
}
PRINT = {
    'page': (0.961, 0.969, 0.957),
    'panel': (1.0, 1.0, 1.0),
    'panel_edge': (0.55, 0.60, 0.57),
    'ink': (0.075, 0.125, 0.078),
    'muted': (0.32, 0.38, 0.35),
    'accent': (0.05, 0.38, 0.20),
    'rule': (0.70, 0.75, 0.72),
}


@dataclass
class CardImage:
    """One embedded frame: raw JPEG bytes with decoded dimensions."""

    jpeg: bytes
    width: int
    height: int


@dataclass
class CardSection:
    label: str
    lines: list[str] = field(default_factory=list)
    keep_together: bool = True


@dataclass
class PrintableCard:
    card_ref: str
    title: str
    subtitle: str = ''
    status_line: str = ''
    revision_line: str = ''
    visual_intent: str = ''
    image: CardImage | None = None
    sections: list[CardSection] = field(default_factory=list)
    next_action: str = ''


def _escape(text: str) -> str:
    ascii_text = text.encode('latin-1', 'replace').decode('latin-1')
    return ascii_text.replace('\\', r'\\').replace('(', r'\(').replace(')', r'\)')


def _wrap(text: str, columns: int) -> list[str]:
    if not text or not text.strip():
        return []
    words = text.split()
    lines: list[str] = []
    current = ''
    for word in words:
        candidate = f'{current} {word}'.strip()
        if len(candidate) <= columns:
            current = candidate
            continue
        if current:
            lines.append(current)
        while len(word) > columns:
            lines.append(word[:columns])
            word = word[columns:]
        current = word
    if current:
        lines.append(current)
    return lines or []


def jpeg_size(payload: bytes) -> tuple[int, int] | None:
    """Read JPEG dimensions from the first baseline/progressive SOF marker, stdlib only."""

    if len(payload) < 4 or payload[0:2] != b'\xff\xd8':
        return None
    cursor = 2
    while cursor + 4 <= len(payload):
        if payload[cursor] != 0xFF:
            cursor += 1
            continue
        marker = payload[cursor + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            if cursor + 9 > len(payload):
                return None
            height = int.from_bytes(payload[cursor + 5:cursor + 7], 'big')
            width = int.from_bytes(payload[cursor + 7:cursor + 9], 'big')
            if width > 0 and height > 0:
                return (width, height)
            return None
        if marker in (0xD8, 0xD9) or (0xD0 <= marker <= 0xD7) or marker == 0x01:
            cursor += 2
            continue
        length = int.from_bytes(payload[cursor + 2:cursor + 4], 'big')
        if length < 2:
            return None
        cursor += 2 + length
    return None


def _color(ops: list[str], rgb: tuple[float, float, float]) -> None:
    ops.append(f'{rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f} rg')


class _Page:
    def __init__(self, palette: dict[str, tuple[float, float, float]]) -> None:
        self.ops: list[str] = []
        self.palette = palette
        r, g, b = palette['page']
        self.ops.append(f'{r:.3f} {g:.3f} {b:.3f} rg 0 0 {PAGE_WIDTH:.0f} {PAGE_HEIGHT:.0f} re f')

    def rect(self, x: float, y: float, w: float, h: float, fill: tuple[float, float, float],
        edge: tuple[float, float, float] | None = None) -> None:
        r, g, b = fill
        self.ops.append(f'{r:.3f} {g:.3f} {b:.3f} rg {x:.1f} {y:.1f} {w:.1f} {h:.1f} re f')
        if edge is not None:
            r, g, b = edge
            self.ops.append(f'{r:.3f} {g:.3f} {b:.3f} RG 0.8 w {x:.1f} {y:.1f} {w:.1f} {h:.1f} re S')

    def rule(self, x: float, y: float, w: float) -> None:
        r, g, b = self.palette['rule']
        self.ops.append(f'{r:.3f} {g:.3f} {b:.3f} RG 0.8 w {x:.1f} {y:.1f} m {x + w:.1f} {y:.1f} l S')

    def text(self, font: str, size: float, x: float, y: float, value: str,
        color: tuple[float, float, float] | None = None) -> None:
        _color(self.ops, color or self.palette['ink'])
        self.ops.append(f'BT /{font} {size:.1f} Tf {x:.1f} {y:.1f} Td ({_escape(value)}) Tj ET')


class _CardRenderer:
    def __init__(self, style: str) -> None:
        self.palette = STANDARD if style == 'standard' else PRINT
        self.pages: list[_Page] = []
        self.images: list[CardImage] = []
        self._cursor = 0.0
        self._page_no = 1
        self.page: _Page = self._new_page()

    def _new_page(self) -> _Page:
        page = _Page(self.palette)
        self.pages.append(page)
        return page

    def _header(self, card: PrintableCard, continued: bool) -> float:
        title = f'{card.card_ref} (continued)' if continued else card.card_ref
        self.page.text('F2', 11, MARGIN, PAGE_HEIGHT - 30, f'TONDE  -  {title}')
        if card.revision_line:
            self.page.text('F1', 7, PAGE_WIDTH - MARGIN - 260, PAGE_HEIGHT - 30,
                card.revision_line[:70], self.palette['muted'])
        self.page.rule(MARGIN, PAGE_HEIGHT - 38, CONTENT_WIDTH)
        y = PAGE_HEIGHT - 62
        self.page.text('F2', 21, MARGIN, y, card.title[:80])
        if card.status_line:
            self.page.text('F1', 8, MARGIN, y - 16, card.status_line[:110], self.palette['accent'])
            y -= 16
        if card.subtitle:
            for line in _wrap(card.subtitle, 120)[:2]:
                y -= 13
                self.page.text('F1', 9, MARGIN, y, line, self.palette['muted'])
        self.page.rule(MARGIN, y - 10, CONTENT_WIDTH)
        return y - 22

    def _footer(self, left: str, right: str) -> None:
        self.page.rule(MARGIN, 30, CONTENT_WIDTH)
        self.page.text('F1', 6.5, MARGIN, 18, left[:100], self.palette['muted'])
        self.page.text('F1', 6.5, PAGE_WIDTH - MARGIN - 120, 18, right[:30], self.palette['muted'])

    def _need(self, height: float, card: PrintableCard) -> float:
        if self._cursor - height >= 44:
            return self._cursor
        self._footer(f'{card.card_ref}', f'page {self._page_no}')
        self._page_no += 1
        self.page = self._new_page()
        self._cursor = self._header(card, continued=True)
        return self._cursor

    def _section(self, card: PrintableCard, section: CardSection) -> None:
        label_h = 16.0
        line_h = SMALL_LEADING
        body = [line for text in section.lines for line in _wrap(text, 118)] or []
        height = label_h + len(body) * line_h + 14.0
        if section.keep_together and height < 380:
            self._cursor = self._need(height, card)
        self.page.text('F2', 7.5, MARGIN + 8, self._cursor, section.label.upper()[:60],
            self.palette['accent'])
        self._cursor -= label_h
        for line in body:
            if self._cursor < 52:
                self._cursor = self._need(line_h + 8, card)
            self.page.text('F1', 8.5, MARGIN + 8, self._cursor, line)
            self._cursor -= line_h
        self._cursor -= 10.0

    def _visual(self, card: PrintableCard) -> CardSection | None:
        height = 150.0
        self._cursor = self._need(height, card)
        box_x, box_w = MARGIN, 300.0
        box_y = self._cursor - height + 12
        if card.image is not None:
            index = len(self.images)
            self.images.append(card.image)
            frame = card.image
            scale = min((box_w - 4) / frame.width, (height - 28) / frame.height)
            draw_w, draw_h = frame.width * scale, frame.height * scale
            self.page.rect(box_x, box_y, box_w, height - 12, self.palette['panel'],
                self.palette['panel_edge'])
            self.page.ops.append(
                f'q {draw_w:.1f} 0 0 {draw_h:.1f} {box_x + 2:.1f} {box_y + 12:.1f} cm /Im{index} Do Q')
        else:
            self.page.rect(box_x, box_y, box_w, height - 12, self.palette['panel'],
                self.palette['panel_edge'])
            self.page.text('F2', 7.5, box_x + 8, box_y + height - 30, 'VISUAL INTENT',
                self.palette['accent'])
            y = box_y + height - 46
            for line in _wrap(card.visual_intent or 'No visual intent recorded.', 44)[:6]:
                self.page.text('F1', 8.5, box_x + 8, y, line)
                y -= 12
        text_x = box_x + box_w + 16
        self.page.text('F2', 7.5, text_x, self._cursor - 4, 'WHAT HAPPENS', self.palette['accent'])
        y = self._cursor - 20
        first = next((s for s in card.sections if s.label.lower() in ('what happens', 'story purpose')), None)
        if first is not None:
            for text in first.lines:
                for line in _wrap(text, 62)[:8]:
                    if y < 56:
                        break
                    self.page.text('F1', 8.5, text_x, y, line)
                    y -= 12
        self._cursor -= height
        return first

    def render_card(self, card: PrintableCard, production_line: str) -> None:
        # Every card starts on a new page and continues onto further pages instead of shrinking.
        self._page_no = len(self.pages) + 1
        self.page = self._new_page()
        self._cursor = self._header(card, continued=False)
        consumed = self._visual(card)
        for section in card.sections:
            if section is consumed:
                continue
            self._section(card, section)
        if card.next_action:
            self._cursor = self._need(44, card)
            self.page.rect(MARGIN, self._cursor - 32, CONTENT_WIDTH, 40, self.palette['panel'],
                self.palette['panel_edge'])
            self.page.text('F2', 8, MARGIN + 8, self._cursor - 12, 'NEXT ACTION',
                self.palette['accent'])
            self.page.text('F1', 9, MARGIN + 110, self._cursor - 12, card.next_action[:95])
            self._cursor -= 48
        self._footer(f'{card.card_ref}  -  {production_line[:80]}', f'page {len(self.pages)}')


def render_card_pdf(cards: list[PrintableCard], *, title: str, style: str = 'standard',
    production_line: str = '') -> tuple[bytes, int]:
    """Render cards onto landscape pages. Returns (pdf_bytes, page_count)."""

    if style not in ('standard', 'print'):
        raise ValueError(f'Unsupported card PDF style: {style}')
    renderer = _CardRenderer(style)
    # Drop the empty page the constructor opens; each card opens its own pages.
    renderer.pages.clear()
    for card in cards:
        if not card.sections and not card.visual_intent and card.image is None:
            continue
        renderer.render_card(card, production_line)
    if not renderer.pages:
        raise ValueError('There is nothing printable in the selected scope.')
    objects: list[bytes] = []

    def add(payload: bytes) -> int:
        objects.append(payload)
        return len(objects)

    catalog_id = add(b'')
    pages_id = add(b'')
    font_regular = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    font_bold = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
    image_ids: list[int] = []
    for image in renderer.images:
        image_id = add(b'<< /Type /XObject /Subtype /Image /Width ' + str(image.width).encode()
            + b' /Height ' + str(image.height).encode()
            + b' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '
            + str(len(image.jpeg)).encode() + b' >>\nstream\n' + image.jpeg + b'\nendstream')
        image_ids.append(image_id)
    page_ids: list[int] = []
    for number, page in enumerate(renderer.pages):
        resources = f'/Font << /F1 {font_regular} 0 R /F2 {font_bold} 0 R >>'
        if renderer.images:
            xobjects = ' '.join(f'/Im{index} {image_id} 0 R' for index, image_id in enumerate(image_ids))
            resources += f' /XObject << {xobjects} >>'
        content = '\n'.join(page.ops).encode('latin-1')
        compressed = zlib.compress(content, 9)
        stream_id = add(b'<< /Length ' + str(len(compressed)).encode() + b' /Filter /FlateDecode >>\nstream\n'
            + compressed + b'\nendstream')
        page_id = add(f'<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {PAGE_WIDTH:.0f} {PAGE_HEIGHT:.0f}] '
            f'/Resources << {resources} >> /Contents {stream_id} 0 R >>'.encode())
        page_ids.append(page_id)
    objects[catalog_id - 1] = f'<< /Type /Catalog /Pages {pages_id} 0 R >>'.encode()
    kids = ' '.join(f'{page_id} 0 R' for page_id in page_ids)
    objects[pages_id - 1] = f'<< /Type /Pages /Count {len(page_ids)} /Kids [{kids}] >>'.encode()
    out = io.BytesIO()
    out.write(b'%PDF-1.4\n')
    out.write(b'%' + title.encode('latin-1', 'replace')[:60] + b'\n')
    offsets: list[int] = []
    for index, payload in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f'{index} 0 obj\n'.encode())
        out.write(payload)
        out.write(b'\nendobj\n')
    xref_offset = out.tell()
    out.write(f'xref\n0 {len(objects) + 1}\n'.encode())
    out.write(b'0000000000 65535 f \n')
    for offset in offsets:
        out.write(f'{offset:010d} 00000 n \n'.encode())
    out.write(f'trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n'.encode())
    return out.getvalue(), len(page_ids)
