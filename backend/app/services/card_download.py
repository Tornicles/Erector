"""Card downloads: the Studio Card as the source of truth for every PDF.

A download never maintains parallel card data. These models are assembled from the pinned
export content (the same scenes, shots, execution plans, results and media the export law
reconstructs) and rendered by `card_pdf.py`. Studio and PDF therefore share one hierarchy:

* WHAT HAPPENS / WHY (scene purpose, description, story beat)
* director intent (visual intent, techniques, dialogue notes)
* execution direction per Shot (real plans) and generation units (AI plans)
* continuity from / into neighboring cards, resources, results, and the next action

Completeness is evaluated with the same engine Studio uses (`card_completeness`): a card that is
not executable names its gaps as BEFORE YOU SHOOT instead of pretending to be ready.
"""

from __future__ import annotations

import re
from typing import Any

from app.core.errors import AppError
from app.domain.card_completeness import evaluate_card
from app.services.card_pdf import CardImage, CardSection, PrintableCard

SCOPE_TYPES = ('full_production', 'current_card', 'selected_cards', 'episode', 'shot_prompt')
PDF_STYLES = ('standard', 'print')

#: Include keys the setup step may toggle. Sections without data never render, so a toggle for
#: a missing section is hidden rather than offered.
INCLUDE_KEYS = ('visual', 'what', 'purpose', 'direction', 'actor', 'camera', 'blocking', 'lighting',
    'audio', 'location', 'resources', 'continuity', 'shots', 'prompts', 'result', 'next_action')


def _text(value: Any) -> str:
    if value is None:
        return ''
    if isinstance(value, (list, tuple)):
        return '; '.join(_text(item) for item in value if _text(item))
    if isinstance(value, dict):
        return ''
    return str(value).strip()


def _ms(value: Any) -> str:
    try:
        total = int(value or 0)
    except (TypeError, ValueError):
        return ''
    if total <= 0:
        return ''
    seconds, ms = divmod(total, 1000)
    minutes, seconds = divmod(seconds, 60)
    if minutes:
        return f'{minutes}:{seconds:02d}.{ms:03d}'
    return f'{seconds}.{ms:03d}s'


def sanitize_filename(value: str) -> str:
    """TONDE_Zombie_Girl_Card_03.pdf style names; the export guard enforces the same charset."""

    cleaned = re.sub(r'[^A-Za-z0-9]+', '_', value).strip('_')
    return (cleaned or 'Production')[:120]


def shot_display(scene_order: int, index: int) -> str:
    letter = chr(65 + min(max(index, 0), 25))
    return f'{scene_order:02d}{letter}'


def resolve_scope(scope_type: str, scope_refs: dict[str, Any],
    scenes: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str]:
    """Filter pinned scenes to the requested download scope, in production order.

    Unknown ids were already refused at request time; the builder filters again so scope can only
    narrow. An empty selection is an honest error, never an empty PDF.
    """

    ordered = sorted(scenes, key=lambda row: (row.get('sort_order') or 0, str(row.get('id'))))
    if scope_type in (None, '', 'full_production'):
        if not ordered:
            raise AppError('EXPORT_EMPTY_SCOPE', 'conflict',
                'This Production has no cards to download yet.', 409)
        return ordered, 'full_production'
    wanted = [str(value) for value in (scope_refs.get('scene_ids') or []) if str(value)]
    if scope_type == 'shot_prompt':
        # Shot membership is resolved by the caller against the pinned shots; the scope stays
        # valid here as long as it names at least one shot (ids were verified at request time).
        if not [value for value in (scope_refs.get('shot_ids') or []) if str(value)]:
            raise AppError('EXPORT_EMPTY_SCOPE', 'validation',
                'Choose the shot whose prompt card should download.', 422)
        return ordered, 'shot_prompt'
    if scope_type == 'episode':
        act_id = str(scope_refs.get('act_id') or '')
        matched = [row for row in ordered if str(row.get('act_id') or '') == act_id] if act_id else []
        if not matched:
            raise AppError('EXPORT_EMPTY_SCOPE', 'validation',
                'That group has no cards in the pinned Production version.', 422)
        return matched, 'episode'
    if not wanted:
        raise AppError('EXPORT_EMPTY_SCOPE', 'validation',
            'Choose at least one card to download.', 422)
    matched = [row for row in ordered if str(row.get('id')) in set(wanted)]
    order = {value: index for index, value in enumerate(wanted)}
    matched.sort(key=lambda row: order.get(str(row.get('id')), len(order)))
    if not matched:
        raise AppError('EXPORT_EMPTY_SCOPE', 'conflict',
            'The selected cards are not in the pinned Production version.', 409)
    return matched, scope_type


def _scene_shots(scene: dict[str, Any], shots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    scene_id = str(scene.get('id'))
    return sorted((shot for shot in shots if str(shot.get('scene_id')) == scene_id),
        key=lambda row: (row.get('sort_order') or 0, str(row.get('id'))))


def _plans_by_shot(plans: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for plan in plans:
        key = str(plan.get('shot_id'))
        current = merged.get(key, {})
        if int(plan.get('revision') or 0) >= int(current.get('revision') or 0):
            merged[key] = {**current, **plan}
    return merged


def _include(include: dict[str, Any] | None, key: str) -> bool:
    if not include:
        return True
    return bool(include.get(key, True))


def _prompt_lines(plan: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    canonical = plan.get('canonical_prompt')
    if isinstance(canonical, dict) and canonical:
        for key in sorted(canonical):
            value = _text(canonical[key])
            if value:
                lines.append(f'{key}: {value}'[:400])
    elif _text(plan.get('provider_prompt')):
        lines.append(_text(plan.get('provider_prompt'))[:1200])
    return lines


def assemble_cards(*, production: dict[str, Any], scenes: list[dict[str, Any]],
    shots: list[dict[str, Any]], plans: list[dict[str, Any]], results: list[dict[str, Any]],
    scope_type: str, scope_refs: dict[str, Any], include: dict[str, Any] | None = None,
    images: dict[str, CardImage] | None = None, with_results: bool = False) -> list[PrintableCard]:
    """Build printable cards from pinned Production state. Nothing here invents direction."""

    ordered_scenes = sorted(scenes, key=lambda row: (row.get('sort_order') or 0, str(row.get('id'))))
    order_of = {str(row.get('id')): index + 1 for index, row in enumerate(ordered_scenes)}
    scoped, resolved = resolve_scope(scope_type, scope_refs or {}, ordered_scenes)
    plans_by_shot = _plans_by_shot(plans)
    results_by_shot: dict[str, list[dict[str, Any]]] = {}
    for result in results:
        if str(result.get('state') or '').lower() in ('approved', 'final'):
            results_by_shot.setdefault(str(result.get('shot_id')), []).append(result)
    images = images or {}
    cards: list[PrintableCard] = []
    for scene in scoped:
        scene_id = str(scene.get('id'))
        order = order_of.get(scene_id, 0)
        card_ref = f'CARD {order:02d}'
        scene_shots = _scene_shots(scene, shots)
        wanted_shots = {str(value) for value in ((scope_refs or {}).get('shot_ids') or [])}
        if resolved == 'shot_prompt' and wanted_shots:
            scene_shots = [shot for shot in scene_shots if str(shot.get('id')) in wanted_shots]
            if not scene_shots:
                continue
        completeness = evaluate_card(
            {'id': scene_id, 'order': order, 'purpose': scene.get('purpose'),
                'description': scene.get('description'), 'opening_state': scene.get('opening_state'),
                'ending_state': scene.get('ending_state')},
            [{'id': str(shot.get('id')), 'execution_method': shot.get('execution_method') or 'real'}
                for shot in scene_shots],
            {shot_id: plans_by_shot.get(shot_id, {}) for shot_id in
                [str(shot.get('id')) for shot in scene_shots] if shot_id in plans_by_shot})
        status_bits = [card_state_label(completeness.state)]
        methods = {str(shot.get('execution_method') or 'real') for shot in scene_shots}
        mode = 'HYBRID' if 'hybrid' in methods or (('ai' in methods) and ('real' in methods)) else (
            'AI' if methods == {'ai'} else 'REAL')
        status_bits.insert(0, mode)
        duration = _ms(scene.get('planned_duration_ms'))
        if duration:
            status_bits.append(duration)
        if scene_shots:
            status_bits.append(f"{len(scene_shots)} shot{'s' if len(scene_shots) != 1 else ''}")
        sections: list[CardSection] = []
        what = _text(scene.get('description')) or _text(scene.get('purpose'))
        if what and _include(include, 'what'):
            sections.append(CardSection('What happens', [what[:1200]]))
        purpose = _text(scene.get('purpose'))
        if purpose and purpose != what and _include(include, 'purpose'):
            sections.append(CardSection('Why this card exists', [purpose[:800]]))
        intent_bits = [_text(scene.get('visual_intent')), _text(scene.get('story_beat')),
            _text(scene.get('dialogue_notes'))]
        intent = ' '.join(bit for bit in intent_bits if bit)
        if intent and _include(include, 'direction'):
            sections.append(CardSection("Director's intent", [intent[:1200]]))
        action_lines = [_text(line) for line in (scene.get('action_lines') or []) if _text(line)]
        real_bits: list[str] = []
        camera_bits: list[str] = []
        light_bits: list[str] = []
        audio_bits: list[str] = []
        resource_bits: list[str] = []
        prompt_units: list[tuple[str, list[str], dict[str, Any]]] = []
        for index, shot in enumerate(scene_shots):
            plan = plans_by_shot.get(str(shot.get('id')), {})
            display = shot_display(order, index)
            shot_method = str(shot.get('execution_method') or 'real')
            if _include(include, 'shots'):
                shot_lines = _shot_lines(shot, plan, display)
                if shot_lines:
                    sections.append(CardSection(f'Shot {display} - {_text(shot.get("title")) or "Untitled"}'[:80],
                        shot_lines))
            if shot_method in ('real', 'hybrid'):
                for key in ('performance', 'blocking'):
                    value = _text(plan.get(key))
                    if value:
                        real_bits.append(f'{display}: {value}'[:500])
                for key in ('camera_position', 'framing', 'movement'):
                    value = _text(plan.get(key))
                    if value:
                        camera_bits.append(f'{display}: {value}'[:400])
                for key in ('lighting_plan', 'lighting_intent'):
                    value = _text(plan.get(key))
                    if value:
                        light_bits.append(f'{display}: {value}'[:500])
                for key in ('sound_plan', 'microphone_plan'):
                    value = _text(plan.get(key))
                    if value:
                        audio_bits.append(f'{display}: {value}'[:500])
                for key in ('crew_roles', 'environment_requirements', 'location_requirements',
                    'setup_steps', 'capture_checklist'):
                    raw: Any = plan.get(key)
                    if isinstance(raw, list):
                        resource_bits.extend(_text(item)[:200] for item in raw if _text(item))
                    elif _text(raw):
                        resource_bits.append(_text(raw)[:300])
            if shot_method in ('ai', 'hybrid') and _include(include, 'prompts'):
                prompt_lines = _prompt_lines(plan)
                if prompt_lines:
                    prompt_units.append((display, prompt_lines, plan))
        if action_lines and _include(include, 'actor'):
            sections.append(CardSection('Actor / subject direction', action_lines[:12]))
        if real_bits and _include(include, 'actor'):
            sections.append(CardSection('Performance and blocking', real_bits[:14]))
        if camera_bits and _include(include, 'camera'):
            sections.append(CardSection('Camera', camera_bits[:14]))
        if light_bits and _include(include, 'lighting'):
            sections.append(CardSection('Lighting', light_bits[:10]))
        if audio_bits and _include(include, 'audio'):
            sections.append(CardSection('Audio', audio_bits[:10]))
        if resource_bits and _include(include, 'resources'):
            sections.append(CardSection('Resources', sorted(set(resource_bits))[:14]))
        continuity = _continuity_lines(scene, ordered_scenes, order_of)
        if continuity and _include(include, 'continuity'):
            sections.append(CardSection('Continuity', continuity))
        for display, prompt_lines, plan in prompt_units:
            unit = [f'Generation unit {display} - {_ms(plan.get("expected_duration_ms")) or "untimed"}']
            unit.extend(prompt_lines[:14])
            motion = plan.get('motion')
            if isinstance(motion, dict):
                motion_text = _text(motion)
                if motion_text:
                    unit.append(f'Motion: {motion_text}'[:400])
            avoid = plan.get('negative_constraints')
            if isinstance(avoid, list) and any(_text(item) for item in avoid):
                unit.append('Avoid: ' + '; '.join(_text(item) for item in avoid if _text(item))[:400])
            sections.append(CardSection(f'AI prompt {display}', unit))
        if with_results and _include(include, 'result'):
            result_lines: list[str] = []
            for shot in scene_shots:
                for result in results_by_shot.get(str(shot.get('id')), []):
                    result_lines.append(
                        f"Shot {shot.get('title') or 'Untitled'}: approved result "
                        f"{str(result.get('id'))[:8]}".strip())
            if result_lines:
                sections.append(CardSection('Result', result_lines[:8]))
        if completeness.state != 'READY':
            sections.append(CardSection('Before you shoot',
                [f'Still needed: {gap}' for gap in completeness.missing[:8]] or
                ['Direction is still developing.']))
        cards.append(PrintableCard(
            card_ref=card_ref, title=_text(scene.get('title')) or f'Card {order:02d}',
            subtitle=_text(scene.get('story_beat')),
            status_line='  -  '.join(status_bits),
            revision_line=(f"rev {scene.get('revision')} - {_text(production.get('title'))}"),
            visual_intent=_text(scene.get('visual_intent')),
            image=images.get(scene_id),
            sections=sections,
            next_action=(completeness.next_action_label + ' - ' + completeness.next_action_detail
                if _include(include, 'next_action') else '')))
    return cards


def _shot_lines(shot: dict[str, Any], plan: dict[str, Any], display: str) -> list[str]:
    lines: list[str] = []
    purpose = _text(shot.get('purpose')) or _text(shot.get('description'))
    if purpose:
        lines.append(purpose[:400])
    for key in ('framing', 'movement', 'action'):
        value = _text(shot.get(key))
        if value:
            lines.append(f'{key}: {value}'[:300])
    duration = _ms(shot.get('planned_duration_ms'))
    if duration:
        lines.append(f'Duration: {duration}')
    method = str(shot.get('execution_method') or 'real')
    lines.append(f'Execution: {method.upper()}')
    return lines


def _continuity_lines(scene: dict[str, Any], ordered: list[dict[str, Any]],
    order_of: dict[str, int]) -> list[str]:
    lines: list[str] = []
    opening, ending = _text(scene.get('opening_state')), _text(scene.get('ending_state'))
    if opening:
        lines.append(f'Starts: {opening}'[:300])
    if ending:
        lines.append(f'Ends: {ending}'[:300])
    order = order_of.get(str(scene.get('id')), 0)
    if order > 1 and order - 1 <= len(ordered):
        previous = ordered[order - 2]
        previous_end = _text(previous.get('ending_state'))
        if previous_end:
            lines.append(f"From card {order - 1:02d}: {previous_end}"[:300])
    if 0 < order < len(ordered):
        following = ordered[order]
        following_start = _text(following.get('opening_state'))
        if following_start:
            lines.append(f"Into card {order + 1:02d}: {following_start}"[:300])
    return lines


def card_state_label(state: str) -> str:
    return {'READY': 'READY', 'DRAFT': 'DRAFT', 'NEEDS YOU': 'NEEDS YOU'}.get(state, 'DRAFT')


def download_filename(*, production_title: str, scope_type: str, scope_refs: dict[str, Any],
    style: str, card_count: int) -> str:
    """TONDE_Zombie_Girl_Card_03.pdf style names from real scope, never demo fixtures."""

    slug = sanitize_filename(production_title or 'Production')
    shots = [str(value) for value in (scope_refs.get('shot_ids') or [])]
    if scope_type == 'shot_prompt' and shots:
        suffix = 'Prompt'
    elif scope_type == 'current_card':
        suffix = 'Card'
    elif scope_type == 'selected_cards':
        suffix = 'Shoot_Cards' if card_count != 1 else 'Card'
    elif scope_type == 'episode':
        suffix = 'Episode'
    else:
        suffix = 'Full_Production'
    name = f'TONDE_{slug}_{suffix}'
    if style == 'print':
        name += '_Print'
    return name + '.pdf'


def cover_card(*, production_title: str, scope_label: str, card_count: int,
    creative_direction: str, revision_line: str) -> PrintableCard:
    return PrintableCard(
        card_ref='COVER', title=production_title or 'Production',
        subtitle=f'{scope_label} - {card_count} card{"s" if card_count != 1 else ""}',
        status_line='TONDE PRODUCTION DOWNLOAD', revision_line=revision_line,
        sections=[CardSection('Creative direction', [creative_direction[:1200]])
           ] if creative_direction else [])
