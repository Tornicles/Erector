"""Card downloads: scope narrows honestly, filenames are safe, PDFs are landscape cards."""

import re

import pytest

from app.core.errors import AppError
from app.services.card_download import (
    assemble_cards,
    cover_card,
    download_filename,
    resolve_scope,
    sanitize_filename,
)
from app.services.card_pdf import jpeg_size, render_card_pdf
from app.services.card_pdf import PrintableCard, CardSection
from app.services.media.documents import extract_pdf


SCENE_A = {'id': 'scene-a', 'act_id': None, 'title': 'The Morning', 'purpose': 'Wake the story.',
    'description': 'Maya wakes to silence.', 'story_beat': 'Hook', 'opening_state': 'Asleep.',
    'ending_state': 'Awake.', 'visual_intent': 'Cold light.', 'dialogue_notes': '',
    'action_lines': ['Maya sits up.'], 'sort_order': 1, 'planned_duration_ms': 20000, 'revision': 2}
SCENE_B = {'id': 'scene-b', 'act_id': None, 'title': 'The Street', 'purpose': 'Prove the city empty.',
    'description': 'An empty street.', 'story_beat': '', 'opening_state': 'Awake.',
    'ending_state': 'Afraid.', 'visual_intent': '', 'dialogue_notes': '', 'action_lines': [],
    'sort_order': 2, 'planned_duration_ms': 30000, 'revision': 1}
SHOT_A = {'id': 'shot-a', 'scene_id': 'scene-a', 'title': 'Wake master', 'purpose': 'Establish.',
    'description': '', 'action': '', 'subject': '', 'framing': 'wide', 'angle': '', 'movement': 'push',
    'composition': '', 'execution_method': 'real', 'planned_duration_ms': 20000}
REAL_PLAN = {'shot_id': 'shot-a', 'execution_method': 'real', 'plan_status': 'ready',
    'performance': 'Sit up slowly.', 'blocking': 'Bed to window.', 'camera_position': 'Doorway.',
    'framing': 'Wide.', 'lighting_plan': 'Window light.', 'sound_plan': 'Room tone.',
    'setup_steps': ['Blackout off.'], 'revision': 1}


def _content(**overrides: object) -> dict:
    base: dict = {'production': {'title': 'Zombie Girl', 'revision': 4},
        'scenes': [SCENE_A, SCENE_B], 'shots': [SHOT_A], 'plans': [REAL_PLAN], 'results': []}
    base.update(overrides)
    return base


def _assemble(**overrides: object) -> list:
    content = _content()
    kwargs = {'production': content['production'], 'scenes': content['scenes'],
        'shots': content['shots'], 'plans': content['plans'], 'results': content['results'],
        'scope_type': 'full_production', 'scope_refs': {}}
    kwargs.update(overrides)
    return assemble_cards(**kwargs)


def test_full_scope_keeps_production_order_and_numbers_cards():
    cards = _assemble()
    assert [card.card_ref for card in cards] == ['CARD 01', 'CARD 02']
    assert cards[0].title == 'The Morning'
    assert 'REAL' in cards[0].status_line and 'READY' in cards[0].status_line


def test_selected_scope_orders_by_request_and_refuses_emptiness():
    cards = _assemble(scope_type='selected_cards', scope_refs={'scene_ids': ['scene-b', 'scene-a']})
    assert [card.title for card in cards] == ['The Street', 'The Morning']
    with pytest.raises(AppError):
        _assemble(scope_type='selected_cards', scope_refs={'scene_ids': []})
    with pytest.raises(AppError):
        _assemble(scope_type='current_card',
            scope_refs={'scene_ids': ['00000000-0000-4000-8000-000000000099']})


def test_episode_scope_filters_by_group():
    scenes = [dict(SCENE_A, act_id='act-1'), dict(SCENE_B, act_id='act-2')]
    matched, resolved = resolve_scope('episode', {'act_id': 'act-1'}, scenes)
    assert resolved == 'episode' and len(matched) == 1 and matched[0]['id'] == 'scene-a'
    with pytest.raises(AppError):
        resolve_scope('episode', {'act_id': 'act-missing'}, scenes)


def test_shot_prompt_scope_keeps_only_the_named_shot():
    cards = _assemble(scope_type='shot_prompt', scope_refs={'shot_ids': ['shot-a']})
    assert len(cards) == 1 and cards[0].card_ref == 'CARD 01'
    with pytest.raises(AppError):
        _assemble(scope_type='shot_prompt', scope_refs={'shot_ids': []})


def test_incomplete_card_names_gaps_instead_of_claiming_ready():
    cards = _assemble()
    street = next(card for card in cards if card.title == 'The Street')
    assert 'DRAFT' in street.status_line
    before = next(section for section in street.sections if section.label == 'Before you shoot')
    assert any('shots' in line for line in before.lines)


def test_filenames_follow_the_tonde_convention_and_stay_safe():
    assert download_filename(production_title='Zombie Girl!', scope_type='current_card',
        scope_refs={}, style='standard', card_count=1) == 'TONDE_Zombie_Girl_Card.pdf'
    assert download_filename(production_title='Zombie Girl', scope_type='full_production',
        scope_refs={}, style='print', card_count=9) == 'TONDE_Zombie_Girl_Full_Production_Print.pdf'
    assert download_filename(production_title='///', scope_type='episode',
        scope_refs={}, style='standard', card_count=12) == 'TONDE_Production_Episode.pdf'
    name = download_filename(production_title='Zombie Girl', scope_type='selected_cards',
        scope_refs={}, style='standard', card_count=3)
    assert re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/-]*', name)
    assert sanitize_filename('  Night / Shoot: v2  ') == 'Night_Shoot_v2'


def test_rendered_pdf_is_landscape_with_selectable_card_text():
    cards = _assemble()
    payload, pages = render_card_pdf(cards, title='Zombie Girl', style='standard',
        production_line='Zombie Girl - rev 4')
    assert payload[:5] == b'%PDF-'
    assert b'792 612' in payload, 'US Letter landscape'
    assert pages >= len(cards), 'one card starts on a new page and may continue'
    text = extract_pdf(payload).text
    assert 'CARD 01' in text and 'The Morning' in text
    assert 'NEXT ACTION' in text


def test_print_style_shares_layout_with_light_paper():
    cards = _assemble()
    dark, _ = render_card_pdf(cards, title='Z', style='standard')
    light, _ = render_card_pdf(cards, title='Z', style='print')
    assert dark != light
    assert extract_pdf(light).text == extract_pdf(dark).text, 'style changes paper, not content'
    with pytest.raises(ValueError):
        render_card_pdf(cards, title='Z', style='sepia')


def test_long_cards_continue_instead_of_shrinking():
    sections = [CardSection(f'Section {index}', [f'Line {n} of direction detail.' for n in range(30)])
        for index in range(6)]
    card = PrintableCard(card_ref='CARD 01', title='Long card', status_line='REAL - DRAFT',
        sections=sections, next_action='PLAN COVERAGE - add shots.')
    _, pages = render_card_pdf([card], title='Z', style='standard')
    assert pages > 1
    text = extract_pdf(render_card_pdf([card], title='Z', style='standard')[0]).text
    assert 'SECTION 5' in text and 'continued' in text


def test_cover_carries_production_truth_not_demo_fixtures():
    cover = cover_card(production_title='Marquee Film', scope_label='Full production', card_count=12,
        creative_direction='A keeper loses the light.', revision_line='Marquee Film - rev 3')
    assert cover.title == 'Marquee Film'
    assert 'Zombie' not in cover.subtitle and 'Maya' not in ' '.join(
        line for section in cover.sections for line in section.lines)


def test_jpeg_dimensions_parse_and_non_jpeg_is_refused():
    header = (b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
        b'\xff\xc0\x00\x11\x08\x01\x2c\x02\x80\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01')
    assert jpeg_size(header) == (640, 300)
    assert jpeg_size(b'not-an-image') is None
    assert jpeg_size(b'\xff\xd8\xff\xd9') is None
