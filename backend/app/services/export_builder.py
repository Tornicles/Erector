"""Prompt 10 packet 035 - the real export renderers (PDF, DOCX, ZIP).

Packet 033 created export persistence and its law. This module produces the bytes that law describes,
with the standard library only, so that no new runtime dependency and no network call is needed to
write a document:

* `render_pdf` writes a small but valid PDF 1.4 with Flate-compressed content streams. The project's
  own `app.services.media.documents.extract_pdf` can read it back, which is how the round trip is
  proven rather than asserted.
* `render_docx` writes the three OOXML parts a viewer needs, so `extract_docx` reads it back.
* `render_zip` writes a deterministic archive: fixed entry timestamps, sorted names, no OS metadata.

Everything here is pure: the same blocks produce the same bytes. Nothing invents content - a section
that has no data is simply absent, and the caller records why.
"""

from __future__ import annotations

import hashlib
import io
import zipfile
import zlib
from dataclasses import dataclass, field
from typing import Literal

PDF_PAGE_WIDTH = 612.0
PDF_PAGE_HEIGHT = 792.0
PDF_MARGIN = 56.0
PDF_LEADING = 13.0
PDF_BODY_SIZE = 10.0
PDF_HEADING_SIZE = 13.0
PDF_TITLE_SIZE = 18.0
PDF_META_SIZE = 8.5
PDF_WRAP_COLUMNS = 92
ZIP_FIXED_DATE = (1980, 1, 1, 0, 0, 0)

BlockKind = Literal['title', 'heading', 'subheading', 'body', 'bullet', 'meta', 'spacer']


@dataclass(frozen=True)
class Block:
    """One line of rendered output.

    A block is deliberately flat: a heading is a heading, a bullet is a bullet. Nothing here decides
    what content means, so the same blocks can be rendered to any supported format identically.
    """

    kind: BlockKind
    text: str = ''

    @staticmethod
    def title(text: str) -> 'Block':
        return Block('title', text)

    @staticmethod
    def heading(text: str) -> 'Block':
        return Block('heading', text)

    @staticmethod
    def subheading(text: str) -> 'Block':
        return Block('subheading', text)

    @staticmethod
    def body(text: str = '') -> 'Block':
        return Block('body', text)

    @staticmethod
    def bullet(text: str) -> 'Block':
        return Block('bullet', text)

    @staticmethod
    def meta(text: str) -> 'Block':
        return Block('meta', text)

    @staticmethod
    def spacer() -> 'Block':
        return Block('spacer')


def _pdf_escape(text: str) -> str:
    ascii_text = text.encode('latin-1', 'replace').decode('latin-1')
    return ascii_text.replace('\\', r'\\').replace('(', r'\(').replace(')', r'\)')


def _pdf_wrap(text: str, columns: int = PDF_WRAP_COLUMNS) -> list[str]:
    if not text:
        return ['']
    words = text.split(' ')
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
    lines.append(current)
    return lines


def _pdf_line_text(block: Block) -> str:
    if block.kind == 'bullet':
        return f'- {block.text}'
    return block.text


def render_pdf(blocks: list[Block], *, document_title: str) -> bytes:
    """Render blocks as a valid PDF 1.4 document.

    Pagination is deterministic (fixed leading and page height), so the same blocks always produce the
    same pages. Text is written as literal strings inside a Flate-compressed content stream, which the
    project's own extractor recovers.
    """

    lines: list[tuple[str, str, float]] = []
    for block in blocks:
        if block.kind == 'spacer':
            lines.append(('body', '', PDF_BODY_SIZE))
            continue
        size = {'title': PDF_TITLE_SIZE, 'heading': PDF_HEADING_SIZE, 'subheading': PDF_BODY_SIZE + 1,
            'meta': PDF_META_SIZE}.get(block.kind, PDF_BODY_SIZE)
        font = 'F2' if block.kind in ('title', 'heading', 'subheading') else 'F1'
        for wrapped in _pdf_wrap(_pdf_line_text(block)):
            lines.append((font, wrapped, size))
    if not lines:
        lines = [('F1', '', PDF_BODY_SIZE)]

    per_page = int((PDF_PAGE_HEIGHT - PDF_MARGIN * 2) // PDF_LEADING)
    pages = [lines[index:index + per_page] for index in range(0, len(lines), per_page)]

    objects: list[bytes] = []

    def add(payload: bytes) -> int:
        objects.append(payload)
        return len(objects)

    catalog_id = add(b'')  # placeholder, written last
    pages_id = add(b'')
    font_regular = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    font_bold = add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')

    page_ids: list[int] = []
    for page_lines in pages:
        y = PDF_PAGE_HEIGHT - PDF_MARGIN
        parts: list[str] = []
        for font, text, size in page_lines:
            if text:
                parts.append(f'BT /{font} {size} Tf {PDF_MARGIN} {y:.2f} Td ({_pdf_escape(text)}) Tj ET')
            y -= PDF_LEADING
        content = '\n'.join(parts).encode('latin-1')
        compressed = zlib.compress(content, 9)
        stream_id = add(b'<< /Length ' + str(len(compressed)).encode() + b' /Filter /FlateDecode >>\nstream\n'
            + compressed + b'\nendstream')
        page_id = add(f'<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {PDF_PAGE_WIDTH:.0f} {PDF_PAGE_HEIGHT:.0f}] '
            f'/Resources << /Font << /F1 {font_regular} 0 R /F2 {font_bold} 0 R >> >> /Contents {stream_id} 0 R >>'.encode())
        page_ids.append(page_id)

    objects[catalog_id - 1] = f'<< /Type /Catalog /Pages {pages_id} 0 R >>'.encode()
    kids = ' '.join(f'{page_id} 0 R' for page_id in page_ids)
    objects[pages_id - 1] = f'<< /Type /Pages /Count {len(page_ids)} /Kids [{kids}] >>'.encode()

    out = io.BytesIO()
    out.write(b'%PDF-1.4\n')
    out.write(b'%' + document_title.encode('latin-1', 'replace')[:60] + b'\n')
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
    return out.getvalue()


def _xml_escape(text: str) -> str:
    return (text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        .replace('"', '&quot;').replace("'", '&apos;'))


def render_docx(blocks: list[Block], *, document_title: str) -> bytes:
    """Render blocks as a minimal, valid .docx (three OOXML parts, deterministic bytes)."""

    paragraphs: list[str] = []
    for block in blocks:
        if block.kind == 'spacer':
            paragraphs.append('<w:p/>')
            continue
        bold = block.kind in ('title', 'heading', 'subheading')
        italic = block.kind == 'meta'
        size = {'title': 32, 'heading': 26}.get(block.kind, 22)
        properties = f'<w:rPr><w:sz w:val="{size}"/>' + ('<w:b/>' if bold else '') + ('<w:i/>' if italic else '') + '</w:rPr>'
        text = ('- ' if block.kind == 'bullet' else '') + block.text
        paragraphs.append(f'<w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r>{properties}'
            f'<w:t xml:space="preserve">{_xml_escape(text)}</w:t></w:r></w:p>')

    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:body>{"".join(paragraphs)}'
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
        '</w:body></w:document>')
    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '</Types>')
    relationships = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '</Relationships>')
    core = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>'
        f'{_xml_escape(document_title)}</dc:title></cp:coreProperties>')
    return _archive([
        ('[Content_Types].xml', content_types.encode()),
        ('_rels/.rels', relationships.encode()),
        ('docProps/core.xml', core.encode()),
        ('word/document.xml', document.encode()),
    ])


def _archive(entries: list[tuple[str, bytes]]) -> bytes:
    """Write a deterministic ZIP: sorted names, fixed timestamp, no extra OS metadata."""

    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, payload in sorted(entries):
            info = zipfile.ZipInfo(filename=name, date_time=ZIP_FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, payload)
    return out.getvalue()


def render_zip(entries: list[tuple[str, bytes]]) -> bytes:
    """Write the Production Package archive from its deterministic relative paths and bytes."""

    return _archive(entries)


def sha256_checksum(payload: bytes) -> str:
    """The only checksum form TONDE records: a real digest of the bytes it is describing."""

    return 'sha256:' + hashlib.sha256(payload).hexdigest()


def canonical_json(payload: object) -> bytes:
    """Serialize package metadata so the same facts always produce the same bytes."""

    import json

    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')


@dataclass(frozen=True)
class RenderedDocument:
    content: bytes
    media_type: str
    filename: str
    blocks: list[Block] = field(default_factory=list)

    @property
    def checksum(self) -> str:
        return sha256_checksum(self.content)


def render_document(blocks: list[Block], *, title: str, requested_format: str) -> RenderedDocument:
    """Render the Full Document in the format the creator requested.

    An unsupported format is refused by name rather than silently rendered as something else.
    """

    if requested_format == 'pdf':
        return RenderedDocument(render_pdf(blocks, document_title=title), 'application/pdf', 'production.pdf', blocks)
    if requested_format == 'docx':
        return RenderedDocument(render_docx(blocks, document_title=title),
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'production.docx', blocks)
    raise ValueError(f'Unsupported document format: {requested_format}')
