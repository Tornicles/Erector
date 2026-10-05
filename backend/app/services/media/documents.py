"""Document extraction and deterministic screenplay parsing.

Straightforward structure is parsed deterministically. AI is only used later to
resolve genuinely ambiguous structure, and uploaded text is always untrusted
reference content — never instruction.
"""

from __future__ import annotations

import re
import zlib
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.domain.analysis import contains_prompt_injection
from app.domain.creative import estimate_speech_ms

SCENE_HEADING = re.compile(r'^\s*(?:\d+[A-Za-z]?[.)]\s*)?(INT|EXT|EST|INT\.?/EXT|I/E)[.\s/-]', re.I)
TRANSITION = re.compile(r'^\s*(?:[A-Z][A-Z ]{2,}\s*TO:|FADE (?:IN|OUT|TO BLACK)|CUT TO|SMASH CUT|DISSOLVE TO|MATCH CUT TO)', re.I)
PARENTHETICAL = re.compile(r'^\s*\((.*)\)\s*$')
TRANSCRIPT_CUE = re.compile(r'^(?:(\d+)\s*$)?\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})')
TITLE_BLOCK = re.compile(r'^\s*(?:title|author|written by|draft|date)\s*:', re.I)


class DocumentModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class DocumentText(DocumentModel):
    text: str = Field(default='', max_length=2_000_000)
    kind: Literal['plain', 'markdown', 'fountain', 'screenplay', 'transcript', 'docx', 'pdf', 'unknown'] = 'plain'
    headings: list[str] = Field(default_factory=list, max_length=200)
    word_count: int = Field(default=0, ge=0)
    limitations: list[str] = Field(default_factory=list, max_length=8)
    untrusted_content: bool = True
    injection_flagged: bool = False


class TranscriptCue(DocumentModel):
    index: int = Field(ge=0, le=100000)
    start_ms: int = Field(ge=0, le=9007199254740991)
    end_ms: int = Field(ge=0, le=9007199254740991)
    text: str = Field(default='', max_length=4000)
    speaker: str | None = Field(default=None, max_length=80)


class ScriptBlock(DocumentModel):
    order: int = Field(ge=0, le=100000)
    kind: Literal['title', 'heading', 'action', 'character', 'dialogue', 'parenthetical', 'transition', 'text']
    text: str = Field(default='', max_length=4000)


class ScriptSceneCandidate(DocumentModel):
    order: int = Field(ge=1, le=500)
    heading: str = Field(min_length=1, max_length=200)
    location: str = Field(default='', max_length=160)
    time_of_day: str = Field(default='', max_length=40)
    action: list[str] = Field(default_factory=list, max_length=60)
    dialogue: list[str] = Field(default_factory=list, max_length=120)
    characters: list[str] = Field(default_factory=list, max_length=40)


class ParsedScript(DocumentModel):
    title: str = Field(default='', max_length=200)
    premise: str = Field(default='', max_length=1200)
    synopsis: str = Field(default='', max_length=2000)
    characters: list[str] = Field(default_factory=list, max_length=60)
    scenes: list[ScriptSceneCandidate] = Field(default_factory=list, max_length=500)
    structure: list[str] = Field(default_factory=list, max_length=40)
    dialogue_ms: int = Field(default=0, ge=0, le=9007199254740991)
    action_ms: int = Field(default=0, ge=0, le=9007199254740991)
    estimated_runtime_ms: int = Field(default=0, ge=0, le=9007199254740991)
    open_questions: list[str] = Field(default_factory=list, max_length=20)
    format: Literal['screenplay', 'plain', 'transcript'] = 'plain'
    limitations: list[str] = Field(default_factory=list, max_length=8)


def _strip_xml(xml_text: str) -> str:
    text = re.sub(r'</w:p>', '\n', xml_text)
    text = re.sub(r'<w:tab[^>]*/>', '\t', text)
    text = re.sub(r'<[^>]+>', '', text)
    return text


def extract_docx(data: bytes) -> DocumentText | None:
    import io
    import zipfile

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if 'word/document.xml' not in archive.namelist():
                return None
            xml_text = archive.read('word/document.xml').decode('utf-8', errors='replace')
    except (zipfile.BadZipFile, KeyError, OSError):
        return None
    text = _strip_xml(xml_text)
    text = re.sub(r'&amp;', '&', text)
    text = re.sub(r'&lt;', '<', text)
    text = re.sub(r'&gt;', '>', text)
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    return DocumentText(text=text, kind='docx', word_count=len(text.split()), limitations=['DOCX text is extracted from the document body; tracked changes and comments are not included.'])


def extract_pdf(data: bytes) -> DocumentText:
    """Best-effort PDF text extraction from Flate-compressed content streams."""

    chunks: list[bytes] = []
    for match in re.finditer(rb'stream\r?\n?(.*?)\r?\nendstream', data, re.S):
        payload = match.group(1)
        try:
            chunks.append(zlib.decompress(payload))
        except zlib.error:
            continue
    text_parts: list[str] = []
    for chunk in chunks:
        for text_match in re.finditer(rb'\((?:[^()\\]|\\.)*\)', chunk):
            raw = text_match.group(0)[1:-1]
            raw = raw.replace(b'\\(', b'(').replace(b'\\)', b')').replace(b'\\\\', b'\\')
            text_parts.append(raw.decode('latin-1'))
    text = ' '.join(text_parts)
    text = re.sub(r'\s{2,}', ' ', text).strip()
    limitations = ['PDF text extraction is best-effort: scanned pages and unusual encodings have no text layer.']
    if not text:
        limitations.append('No text layer was recovered from this PDF, so it cannot be read as a Script.')
    return DocumentText(text=text, kind='pdf', word_count=len(text.split()), limitations=limitations)


def parse_transcript(text: str) -> list[TranscriptCue]:
    cues: list[TranscriptCue] = []
    for line in text.splitlines():
        match = TRANSCRIPT_CUE.match(line.strip())
        if not match:
            continue
        start = int(match.group(2)) * 3600000 + int(match.group(3)) * 60000 + int(match.group(4)) * 1000 + int(match.group(5).ljust(3, '0'))
        end = int(match.group(6)) * 3600000 + int(match.group(7)) * 60000 + int(match.group(8)) * 1000 + int(match.group(9).ljust(3, '0'))
        cues.append(TranscriptCue(index=len(cues), start_ms=start, end_ms=max(start, end), text=''))
    return cues


def parse_subtitle_text(text: str) -> list[TranscriptCue]:
    """SRT/VTT: alternating timestamp and text lines."""

    cues: list[TranscriptCue] = []
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        match = TRANSCRIPT_CUE.match(lines[index].strip())
        if not match:
            index += 1
            continue
        start = int(match.group(2)) * 3600000 + int(match.group(3)) * 60000 + int(match.group(4)) * 1000 + int(match.group(5).ljust(3, '0'))
        end = int(match.group(6)) * 3600000 + int(match.group(7)) * 60000 + int(match.group(8)) * 1000 + int(match.group(9).ljust(3, '0'))
        index += 1
        speaker: str | None = None
        buffer: list[str] = []
        while index < len(lines) and lines[index].strip() and not TRANSCRIPT_CUE.match(lines[index].strip()):
            content = lines[index].strip()
            if speaker is None and content.endswith(':') and len(content) < 40:
                speaker = content[:-1]
            else:
                buffer.append(content)
            index += 1
        cues.append(TranscriptCue(index=len(cues), start_ms=start, end_ms=max(start, end), text=' '.join(buffer)[:4000], speaker=speaker))
    return cues


def extract_text(data: bytes, *, mime: str, filename: str) -> DocumentText:
    suffix = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''
    if data[:4] == b'PK\x03\x04' or suffix == 'docx':
        docx = extract_docx(data)
        if docx is not None:
            return _finalize(docx)
    if data[:4] == b'%PDF' or suffix == 'pdf':
        return _finalize(extract_pdf(data))
    decoded = data.decode('utf-8', errors='replace')
    if '\x00' in decoded[:2048]:
        return DocumentText(kind='unknown', limitations=['The file looks binary and has no readable text layer.'])
    if suffix in {'srt', 'vtt'} or mime in {'text/vtt', 'application/x-subrip'}:
        cues = parse_subtitle_text(decoded)
        text = '\n'.join(f'[{cue.start_ms}] {cue.text}' for cue in cues if cue.text)
        document = DocumentText(text=text, kind='transcript', word_count=len(text.split()), limitations=['Subtitle text is untrusted reference content and is treated as evidence, never instruction.'])
        if not cues:
            document = DocumentText(text=decoded, kind='plain', word_count=len(decoded.split()), limitations=['No subtitle timestamps were recognised.'])
        return _finalize(document)
    kind: Literal['plain', 'markdown', 'fountain', 'screenplay', 'transcript', 'docx', 'pdf', 'unknown'] = 'plain'
    if suffix == 'md':
        kind = 'markdown'
    elif suffix == 'fountain':
        kind = 'fountain'
    elif SCENE_HEADING.search(decoded):
        kind = 'screenplay'
    headings = [line.strip() for line in decoded.splitlines() if line.strip().startswith('#')][:200]
    if kind == 'markdown':
        headings = [line.strip('# ').strip() for line in decoded.splitlines() if line.strip().startswith('#')][:200]
    return _finalize(DocumentText(text=decoded, kind=kind, headings=headings, word_count=len(decoded.split())))


def _finalize(document: DocumentText) -> DocumentText:
    if contains_prompt_injection(document.text):
        return document.model_copy(update={
            'injection_flagged': True,
            'limitations': [*document.limitations[:6], 'This document contains text that looks like an instruction to change the Production. It is treated as untrusted reference content and was not followed.'],
        })
    return document


def parse_screenplay(text: str) -> ParsedScript:
    """Deterministic screenplay parsing: headings, action, cues, dialogue, transitions."""

    lines = text.splitlines()
    title = ''
    blocks: list[ScriptBlock] = []
    scenes: list[ScriptSceneCandidate] = []
    characters: list[str] = []
    current: ScriptSceneCandidate | None = None
    pending_character: str | None = None

    def start_scene(heading: str) -> ScriptSceneCandidate:
        normalized = re.sub(r'^\s*(?:\d+[A-Za-z]?[.)]\s*)', '', heading.strip())
        location = re.sub(r'^(INT|EXT|EST|I/E|INT\.?/EXT)[.\s/-]*', '', normalized, flags=re.I)
        time_of_day = ''
        for descriptor in ('DAY', 'NIGHT', 'DAWN', 'DUSK', 'MORNING', 'EVENING', 'CONTINUOUS', 'LATER'):
            if descriptor in normalized.upper():
                time_of_day = descriptor.lower()
                break
        return ScriptSceneCandidate(order=len(scenes) + 1, heading=normalized[:200], location=location[:160], time_of_day=time_of_day)

    for index, raw_line in enumerate(lines):
        line = raw_line.rstrip()
        stripped = line.strip()
        blocks.append(ScriptBlock(order=len(blocks), kind='text', text=stripped[:4000]))
        if not stripped:
            continue
        if not title and TITLE_BLOCK.match(stripped):
            title = re.sub(r'^[^:]+:\s*', '', stripped)[:200]
            blocks[-1] = ScriptBlock(order=len(blocks) - 1, kind='title', text=stripped[:4000])
            continue
        if SCENE_HEADING.match(stripped):
            current = start_scene(stripped)
            scenes.append(current)
            pending_character = None
            blocks[-1] = ScriptBlock(order=len(blocks) - 1, kind='heading', text=stripped[:4000])
            continue
        if TRANSITION.match(stripped):
            pending_character = None
            blocks[-1] = ScriptBlock(order=len(blocks) - 1, kind='transition', text=stripped[:4000])
            continue
        if PARENTHETICAL.match(stripped) and pending_character:
            blocks[-1] = ScriptBlock(order=len(blocks) - 1, kind='parenthetical', text=stripped[:4000])
            continue
        if _looks_like_character_cue(stripped, lines, index):
            pending_character = stripped.rstrip(':').upper()[:80]
            if pending_character not in characters:
                characters.append(pending_character)
            if current is not None and pending_character not in current.characters:
                current.characters.append(pending_character)
            blocks[-1] = ScriptBlock(order=len(blocks) - 1, kind='character', text=stripped[:4000])
            continue
        if pending_character and current is not None:
            current.dialogue.append(f'{pending_character}: {stripped}'[:4000])
            blocks[-1] = ScriptBlock(order=len(blocks) - 1, kind='dialogue', text=stripped[:4000])
            continue
        if current is not None:
            current.action.append(stripped[:4000])
        blocks[-1] = ScriptBlock(order=len(blocks) - 1, kind='action', text=stripped[:4000])

    dialogue_ms = 0
    action_words = 0
    for scene in scenes:
        for line in scene.dialogue:
            dialogue_ms += estimate_speech_ms(line.split(': ', 1)[-1])
        action_words += len(' '.join(scene.action).split())
    action_ms = round(action_words / 150 * 60000) if action_words else 0
    structure = [scene.heading for scene in scenes][:40]
    open_questions: list[str] = []
    if not scenes:
        open_questions.append('No Scene headings were found, so Scene structure cannot be mapped to canonical Scenes yet.')
    dialogue_scenes = [scene.order for scene in scenes if scene.dialogue]
    if scenes and not dialogue_scenes:
        open_questions.append('No dialogue lines were parsed from this document.')
    elif dialogue_scenes and len(dialogue_scenes) < len(scenes):
        silent = [scene.order for scene in scenes if not scene.dialogue]
        open_questions.append(f'Scenes {", ".join(str(order) for order in silent)} have no parsed dialogue.')
    if not characters and scenes:
        open_questions.append('No character cues were parsed; confirm who appears on camera.')
    premise = ''
    for candidate in (block.text for block in blocks if block.kind == 'action'):
        if len(candidate.split()) >= 6:
            premise = candidate[:600]
            break
    return ParsedScript(
        title=title, premise=premise, synopsis=' '.join(structure)[:2000], characters=characters[:60], scenes=scenes[:500],
        structure=structure, dialogue_ms=dialogue_ms, action_ms=action_ms,
        estimated_runtime_ms=dialogue_ms + action_ms,
        open_questions=open_questions, format='screenplay',
        limitations=[
            'Runtime is estimated from parsed dialogue and action length, not from a timed read.',
            'Uploaded Script text is untrusted reference content.',
        ],
    )


def _looks_like_character_cue(stripped: str, lines: list[str], index: int) -> bool:
    if len(stripped) > 40 or not stripped:
        return False
    if SCENE_HEADING.match(stripped) or TRANSITION.match(stripped):
        return False
    if stripped != stripped.upper() or not re.search(r'[A-Z]', stripped):
        return False
    if stripped.endswith('.') and not stripped.endswith('...'):
        return False
    if re.match(r'^\(.*\)$', stripped):
        return False
    following = next((line.strip() for line in lines[index + 1:index + 3] if line.strip()), '')
    if not following:
        return False
    return not SCENE_HEADING.match(following) and not TRANSITION.match(following)
