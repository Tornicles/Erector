"""Prompt 6 Real Production Director: Setup-aware execution planning.

This module answers one question for a Shot: *how do I actually shoot this with what
I have?* It reasons from exactly two kinds of fact:

* the Shot/Scene/Production the creator already wrote, and
* the Setup inventory the creator actually owns, as they described it.

Everything else is a labelled claim. Exposure values are STARTING POINTS. Equipment
capabilities are never invented: an unknown model stays unknown.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID

from app.core.errors import AppError
from app.db.client import SupabaseGateway
from app.domain.real_production import (
    AlternativeDraft,
    CaptureStateRequest,
    DeviationRequest,
    PlanApprovalRequest,
    PlanComplexity,
    PlanLockRequest,
    PlanStatus,
    RealPlanDraft,
    RequirementDraft,
    RequirementStatus,
    SaveRealPlanRequest,
    SoloFeasibility,
    TakeRequest,
    alternative_payload,
    deviation_payload,
    real_plan_payload,
    requirement_payload,
    take_payload,
)

# --- Shot language. Preferences, never assertions about the creator's gear. ----

SHOT_SIZE_FOCAL: dict[str, int] = {
    'extreme wide': 16, 'wide': 24, 'full': 35, 'cowboy': 50, 'medium': 50,
    'medium close-up': 65, 'close-up': 85, 'extreme close-up': 100, 'insert': 100,
    'macro': 100, 'over the shoulder': 50, 'point of view': 28, 'two shot': 35,
}
SHOT_SIZE_LABEL: dict[str, str] = {
    'extreme wide': 'Extreme wide', 'wide': 'Wide', 'full': 'Full shot', 'cowboy': 'Cowboy shot',
    'medium': 'Medium shot', 'medium close-up': 'Medium close-up', 'close-up': 'Close-up',
    'extreme close-up': 'Extreme close-up', 'insert': 'Insert', 'macro': 'Macro detail',
    'over the shoulder': 'Over the shoulder', 'point of view': 'Point of view', 'two shot': 'Two shot',
}
# Depth-of-field appetite per shot size: how much of the frame should hold focus.
SHOT_SIZE_DOF: dict[str, str] = {
    'extreme wide': 'f/5.6-f/8 starting point',
    'wide': 'f/4-f/5.6 starting point',
    'full': 'f/4-f/5.6 starting point',
    'cowboy': 'f/2.8-f/4 starting point',
    'medium': 'f/2.8-f/4 starting point',
    'medium close-up': 'f/2.8-f/4 starting point',
    'close-up': 'f/2.8-f/4 starting point',
    'extreme close-up': 'f/4-f/5.6 starting point',
    'insert': 'f/5.6-f/8 starting point',
    'macro': 'f/5.6-f/8 starting point',
    'over the shoulder': 'f/2.8-f/4 starting point',
    'point of view': 'f/4-f/5.6 starting point',
    'two shot': 'f/4-f/5.6 starting point',
}
MOVING_SHOTS = ('push', 'pull', 'truck', 'tracking', 'orbit', 'arc', 'crane', 'gimbal', 'slider', 'drone', 'vehicle')
HIGH_RISK = {
    'traffic': ('traffic', 'road', 'street', 'highway', 'crossing'),
    'heights': ('roof', 'cliff', 'ledge', 'height', 'ladder', 'scaffold', 'balcony'),
    'water': ('water', 'river', 'sea', 'ocean', 'lake', 'pool', 'boat'),
    'electricity': ('mains', 'socket', 'wiring', 'generator', 'electric'),
    'drone': ('drone', 'aerial', 'uav'),
    'vehicle': ('driving', 'car', 'vehicle', 'motorcycle', 'bike', 'moving car', 'in the car'),
    'fire': ('fire', 'flame', 'pyro', 'burn'),
    'weapon': ('weapon', 'gun', 'knife', 'prop gun', 'firearm'),
    'stunt': ('stunt', 'fall', 'jump', 'fight', 'crash'),
    'crowd': ('crowd', 'public', 'market', 'festival'),
}

CAPTURE_CHECKLIST = [
    'Camera mounted and balanced',
    'Battery and media checked',
    'Correct lens fitted',
    'White balance set for the dominant source',
    'Focus verified before rolling',
    'Audio recording and level checked',
    'Product/wardrobe clean and positioned',
]


def _clamp(value: str, limit: int) -> str:
    return value[:limit]


def _clean_list(values: list[str], limit: int = 16, each: int = 200) -> list[str]:
    seen: list[str] = []
    for value in values:
        text = _clamp(str(value).strip(), each)
        if text and text not in seen:
            seen.append(text)
        if len(seen) >= limit:
            break
    return seen


# --- Setup inventory reading. Only what the creator stated. --------------------


def _metadata(resource: dict[str, Any]) -> dict[str, Any]:
    value = resource.get('metadata')
    return value if isinstance(value, dict) else {}


def _focal_length(resource: dict[str, Any]) -> int | None:
    """Focal length from the creator's own metadata, or from how they named it."""
    meta = _metadata(resource)
    value = meta.get('focal_length_mm')
    if isinstance(value, (int, float)) and value > 0:
        return int(value)
    for source in (value, resource.get('name'), resource.get('model')):
        if isinstance(source, str):
            match = re.search(r'(\d+(?:\.\d+)?)\s*mm', source, re.IGNORECASE)
            if match:
                return int(float(match.group(1)))
    return None


def _resource_summary(resource: dict[str, Any]) -> str:
    parts = [resource.get('name') or 'Unnamed']
    if resource.get('model') and resource.get('model') != resource.get('name'):
        parts.append(str(resource['model']))
    return ' '.join(parts)


class SetupInventory:
    """The creator's Setup, read as capability facts rather than assumed specs."""

    def __init__(self, resources: list[dict[str, Any]]) -> None:
        self.resources = resources

    def of_type(self, *types: str) -> list[dict[str, Any]]:
        wanted = set(types)
        return [item for item in self.resources if item.get('resource_type') in wanted]

    def first_of_type(self, *types: str) -> dict[str, Any] | None:
        found = self.of_type(*types)
        return found[0] if found else None

    @property
    def cameras(self) -> list[dict[str, Any]]:
        return self.of_type('camera', 'phone_camera', 'action_camera')

    @property
    def dedicated_cameras(self) -> list[dict[str, Any]]:
        return self.of_type('camera')

    @property
    def phone_cameras(self) -> list[dict[str, Any]]:
        return self.of_type('phone_camera')

    @property
    def lenses(self) -> list[dict[str, Any]]:
        return self.of_type('lens')

    @property
    def lights(self) -> list[dict[str, Any]]:
        return self.of_type('light')

    @property
    def modifiers(self) -> list[dict[str, Any]]:
        return self.of_type('modifier')

    @property
    def microphones(self) -> list[dict[str, Any]]:
        return self.of_type('microphone')

    @property
    def recorders(self) -> list[dict[str, Any]]:
        return self.of_type('recorder')

    @property
    def wireless(self) -> list[dict[str, Any]]:
        return self.of_type('wireless_audio')

    @property
    def supports(self) -> list[dict[str, Any]]:
        return self.of_type('tripod', 'monopod', 'gimbal', 'slider', 'rigging')

    @property
    def filters(self) -> list[dict[str, Any]]:
        return self.of_type('filter')

    def capability(self, *types: str) -> bool:
        return bool(self.of_type(*types))

    def name_of(self, resource: dict[str, Any] | None) -> str:
        return _resource_summary(resource) if resource else ''


# --- Reading the creator's direction. -----------------------------------------


def parse_constraints(text: str, declared: list[str] | None = None) -> set[str]:
    """Read practical constraints from the creator's own words. Deterministic."""
    found = set(declared or [])
    body = (text or '').lower()
    rules: tuple[tuple[str, tuple[str, ...]], ...] = (
        ('phone_only', ('only my phone', 'only a phone', 'use my phone', 'just my phone', 'phone only', 'iphone', 'smartphone')),
        ('use_only_owned', ('only what i own', 'what i have', 'use only what i own', 'nothing else')),
        ('one_light', ('one light', 'single light', 'only one lamp', 'just one light')),
        ('no_gimbal', ("can't use a gimbal", 'cannot use a gimbal', 'no gimbal', "don't have a gimbal", 'without a gimbal')),
        ('available_light_only', ('available light', 'no lights', "i don't have that light", 'lost the light', 'light died', 'use the window')),
        ('solo', ('alone', 'myself', 'solo', 'by myself', 'single operator', 'no crew')),
        ('simplify', ('make this easier', 'make it easier', 'simplify', 'simpler')),
        ('faster', ('faster', 'quickly', 'as fast as', 'speed this up')),
        ('safer', ('make this safer', 'safest', 'safety', 'safer')),
        ('reduced_time', ('20 minutes', '10 minutes', 'five minutes', 'no time', 'short on time', 'running out of time')),
        ('lost_location', ('lost the location', 'location fell through', 'cannot use the location', "can't use the location")),
        ('lost_light', ('light died', 'my light died', "don't have that light", 'lost the light')),
    )
    for name, phrases in rules:
        if any(phrase in body for phrase in phrases):
            found.add(name)
    return found


def shot_size_from(shot: dict[str, Any]) -> str:
    """Read a Shot size from what the creator already wrote about the Shot.

    The explicit framing field outranks prose: a Shot titled 'Scale macro' that the
    creator framed as a close-up is a close-up.
    """
    declared = ' '.join(str(shot.get(key) or '') for key in ('framing', 'shot_size')).lower()
    prose = ' '.join(str(shot.get(key) or '') for key in ('subject', 'title', 'purpose', 'description')).lower()
    for haystack in (declared, prose):
        found = _match_shot_size(haystack)
        if found:
            return found
    return 'medium'


def _match_shot_size(haystack: str) -> str | None:
    ordered: tuple[tuple[str, tuple[str, ...]], ...] = (
        ('extreme wide', ('extreme wide', 'extreme-wide')),
        ('extreme close-up', ('extreme close', 'extreme close-up', 'ecu')),
        ('macro', ('macro', 'texture detail', 'very tight detail')),
        ('insert', ('insert', 'detail shot', 'product insert')),
        ('close-up', ('close-up', 'close up', 'cu ')),
        ('medium close-up', ('medium close', 'mcu')),
        ('over the shoulder', ('over the shoulder', 'over-the-shoulder', 'ots')),
        ('point of view', ('point of view', 'pov')),
        ('two shot', ('two shot', 'two-shot', 'both of them')),
        ('cowboy', ('cowboy', 'mid shot')),
        ('wide', ('wide', 'establishing', 'establish')),
        ('full', ('full shot', 'full body')),
        ('medium', ('medium',)),
    )
    for size, needles in ordered:
        if any(needle in haystack for needle in needles):
            return size
    return None


def movement_from(shot: dict[str, Any], constraints: set[str]) -> str:
    haystack = ' '.join(str(shot.get(key) or '') for key in ('movement', 'purpose', 'title', 'description')).lower()
    ordered: tuple[tuple[str, tuple[str, ...]], ...] = (
        ('drone', ('drone', 'aerial')),
        ('crane', ('crane', 'jib')),
        ('slider', ('slider',)),
        ('gimbal', ('gimbal', 'steadicam')),
        ('tracking', ('tracking', 'dolly', 'follow')),
        ('push', ('push', 'push-in', 'push in')),
        ('pull', ('pull', 'pull-out', 'pull back')),
        ('orbit', ('orbit', 'arc')),
        ('pan', ('pan ', 'panning')),
        ('tilt', ('tilt',)),
        ('handheld', ('handheld', 'hand-held', 'verite')),
        ('locked', ('locked', 'static', 'still')),
    )
    for movement, needles in ordered:
        if any(needle in haystack for needle in needles):
            if movement == 'gimbal' and 'no_gimbal' in constraints:
                return 'handheld'
            if movement == 'drone' and not any(needle in haystack for needle in ('drone', 'aerial')):
                continue
            return movement
    return 'locked'


# --- The director. ------------------------------------------------------------


class RealProductionDirector:
    """Turns a Shot plus a Setup inventory into a practical, labelled plan."""

    def __init__(self, inventory: SetupInventory) -> None:
        self.setup = inventory

    # Camera ------------------------------------------------------------------

    def _choose_camera(self, shot: dict[str, Any], size: str, movement: str, constraints: set[str]
        ) -> tuple[dict[str, Any] | None, RequirementDraft, list[RequirementDraft]]:
        extra: list[RequirementDraft] = []
        phones = self.setup.phone_cameras
        dedicated = self.setup.dedicated_cameras
        actions = self.setup.of_type('action_camera')
        pool = phones if 'phone_only' in constraints else dedicated + actions + phones
        if not pool:
            return None, RequirementDraft(kind='camera', label='Camera', ideal_name='Any working camera',
                status='missing', epistemic='REQUIRED', resource_type='camera',
                alternative='Use any phone you own as the camera, or borrow one. Nothing else in Setup can record this Shot.',
                detail='No camera, phone camera or action camera exists in Setup.'), extra
        if 'phone_only' in constraints and phones:
            chosen = phones[0]
            requirement = RequirementDraft(kind='camera', label='Camera', status='owned', epistemic='REQUIRED',
                resource_type='phone_camera', resource_id=str(chosen['id']), ideal_name='Phone camera',
                detail='The phone is a real production camera with exposure and focus lock; treat it as the primary.')
            return chosen, requirement, extra
        macro_need = size in ('macro', 'insert', 'extreme close-up')
        wants_detail = macro_need and any(_metadata(item).get('macro') is True for item in pool)
        if wants_detail:
            chosen = next(item for item in pool if _metadata(item).get('macro') is True)
            requirement = RequirementDraft(kind='camera', label='Camera', status='owned', epistemic='REQUIRED',
                resource_type=str(chosen.get('resource_type')), resource_id=str(chosen['id']),
                detail='Chosen because your Setup marks it as macro-capable for a detail this tight.')
            return chosen, requirement, extra
        shot_text = ' '.join(str(shot.get(key) or '') for key in ('movement', 'purpose', 'description')).lower()
        slow_motion = 'slow' in shot_text
        prefer_dedicated = 'phone_only' not in constraints
        chosen = (dedicated or actions or phones)[0] if prefer_dedicated else phones[0]
        if slow_motion and any(_metadata(item).get('max_fps') for item in pool):
            qualified = [item for item in pool if isinstance(_metadata(item).get('max_fps'), (int, float))
                and float(_metadata(item)['max_fps']) >= 60]
            if qualified:
                chosen = qualified[0]
        requirement = RequirementDraft(kind='camera', label='Camera', status='owned', epistemic='REQUIRED',
            resource_type=str(chosen.get('resource_type')), resource_id=str(chosen['id']),
            detail='The only camera capability Setup needs for this Shot.')
        if chosen.get('resource_type') == 'phone_camera' and dedicated:
            extra.append(RequirementDraft(kind='camera', label='Second camera (optional)', status='not_required',
                epistemic='OPTIONAL', resource_type='camera', resource_id=str(dedicated[0]['id']),
                detail='A dedicated camera is also in Setup if you later want a second angle.'))
        return chosen, requirement, extra

    # Lens --------------------------------------------------------------------

    def _choose_lens(self, camera: dict[str, Any] | None, size: str, constraints: set[str]
        ) -> tuple[dict[str, Any] | None, RequirementDraft, str]:
        wanted = SHOT_SIZE_FOCAL.get(size, 50)
        if camera is not None and camera.get('resource_type') == 'phone_camera':
            return None, RequirementDraft(kind='lens', label='Lens', status='not_required', epistemic='REQUIRED',
                resource_type='lens', detail="The phone's built-in lenses cover this framing; pick the one that frames the Shot."), ''
        lenses = [item for item in self.setup.lenses if _focal_length(item)]
        ideal = f'{SHOT_SIZE_LABEL.get(size, size)} frames close to {wanted} mm on a full-frame camera.'
        if not lenses:
            return None, RequirementDraft(kind='lens', label='Lens', status='missing' if camera else 'not_required',
                epistemic='REQUIRED', resource_type='lens', ideal_name=f'About {wanted} mm',
                detail='Setup lists no lens with a stated focal length.',
                alternative='Use the lenses you already have on the camera and set the framing by moving the camera.'), ideal
        chosen = min(lenses, key=lambda item: (abs((_focal_length(item) or wanted) - wanted), str(item.get('name'))))
        chosen_focal = _focal_length(chosen) or wanted
        drift = abs(chosen_focal - wanted) / max(wanted, 1)
        perspective = ('Camera position, not focal length, decides perspective: if you move closer to hold the same '
            'framing, the face and background relationship changes with it.')
        if drift <= 0.2:
            return chosen, RequirementDraft(kind='lens', label='Lens', status='owned', epistemic='RECOMMENDED',
                resource_type='lens', resource_id=str(chosen['id']), ideal_name=f'About {wanted} mm',
                detail=f'{chosen_focal} mm is the closest you own to the {wanted} mm this Shot size wants.'), perspective
        substitute = RequirementDraft(kind='lens', label='Lens', status='substitute', epistemic='RECOMMENDED',
            resource_type='lens', substitute_resource_id=str(chosen['id']),
            ideal_name=f'About {wanted} mm for {SHOT_SIZE_LABEL.get(size, size)}',
            detail=f'You own {chosen_focal} mm, which is the nearest available focal length.',
            alternative=(f'Use the {chosen_focal} mm and move the camera '
                f'{"back" if chosen_focal < wanted else "closer"} until the framing matches. '
                + perspective))
        return chosen, substitute, perspective

    # Stabilization -----------------------------------------------------------

    def _choose_support(self, movement: str, constraints: set[str]) -> tuple[dict[str, Any] | None, RequirementDraft, str, list[str]]:
        flags: list[str] = []
        tripod = self.setup.of_type('tripod')
        monopod = self.setup.of_type('monopod')
        gimbal = [] if 'no_gimbal' in constraints else self.setup.of_type('gimbal')
        slider = self.setup.of_type('slider')
        rigging = self.setup.of_type('rigging')
        if movement == 'locked':
            if tripod:
                return tripod[0], RequirementDraft(kind='stabilization', label='Support', status='owned',
                    epistemic='REQUIRED', resource_type='tripod', resource_id=str(tripod[0]['id']),
                    detail='A locked Shot needs the frame to stop moving.'), 'Tripod, locked off', flags
            if rigging:
                return rigging[0], RequirementDraft(kind='stabilization', label='Support', status='substitute',
                    epistemic='REQUIRED', resource_type='rigging', substitute_resource_id=str(rigging[0]['id']),
                    ideal_name='Tripod', alternative='Brace the camera on a stable surface or rigging you own.'), 'Braced on what you have', flags
            return None, RequirementDraft(kind='stabilization', label='Support', status='substitute',
                epistemic='REQUIRED', resource_type='tripod', ideal_name='Tripod',
                alternative='Brace the camera on a counter, table or wall and hold still; keep the Shot short and roll twice.',
                detail='Setup lists no tripod, monopod, gimbal or rigging.'), 'Handheld and braced', flags
        if movement in ('push', 'pull', 'truck', 'tracking'):
            if slider:
                return slider[0], RequirementDraft(kind='stabilization', label='Support', status='owned',
                    epistemic='RECOMMENDED', resource_type='slider', resource_id=str(slider[0]['id']),
                    detail='A slider gives repeatable travel for this move.'), 'Slider move', flags
            if gimbal:
                return gimbal[0], RequirementDraft(kind='stabilization', label='Support', status='owned',
                    epistemic='RECOMMENDED', resource_type='gimbal', resource_id=str(gimbal[0]['id']),
                    detail='A gimbal is the moving support you own.'), 'Gimbal move', flags
            if tripod:
                return tripod[0], RequirementDraft(kind='stabilization', label='Support', status='substitute',
                    epistemic='RECOMMENDED', resource_type='tripod', substitute_resource_id=str(tripod[0]['id']),
                    ideal_name='Slider or gimbal',
                    alternative='Do the move on the tripod as a slow pan or tilt, or as a locked Shot with the subject moving instead.',
                    detail='A tripod cannot travel, so the move becomes a pan, tilt or a subject-led move.'), 'Locked or pivoting on the tripod', flags
            return None, RequirementDraft(kind='stabilization', label='Support', status='missing',
                epistemic='RECOMMENDED', resource_type='slider', ideal_name='Slider, gimbal or tripod',
                alternative='Shoot it locked and let the subject move, or borrow a tripod. Handheld travel will not hold this framing.',
                detail='Setup lists nothing that can carry a moving camera.'), 'Locked, subject-led move', flags
        if movement == 'handheld':
            note = 'Handheld; keep elbows in and roll longer than you need.'
            if 'no_gimbal' in constraints:
                note += ' A gimbal is excluded by your instruction.'
            return None, RequirementDraft(kind='stabilization', label='Support', status='not_required',
                epistemic='RECOMMENDED', resource_type='gimbal', detail=note), 'Handheld', flags
        if movement in ('drone',):
            flags.append('drone')
            drone = self.setup.of_type('drone')
            if drone:
                return drone[0], RequirementDraft(kind='stabilization', label='Aerial platform', status='unverified',
                    epistemic='UNKNOWN', resource_type='drone', resource_id=str(drone[0]['id']),
                    detail='Setup lists a drone, but airspace, site rules and operator qualification are unverified here.',
                    alternative='Shoot the same beat from a high handheld position or a longer lens from ground level.'), 'Drone capture', flags
            return None, RequirementDraft(kind='stabilization', label='Aerial platform', status='missing',
                epistemic='RECOMMENDED', resource_type='drone', ideal_name='Drone',
                alternative='Get the same read from a high angle on a tripod, or from a window above the subject.'), 'No aerial platform owned', flags
        if monopod:
            return monopod[0], RequirementDraft(kind='stabilization', label='Support', status='owned',
                epistemic='RECOMMENDED', resource_type='monopod', resource_id=str(monopod[0]['id']),
                detail='A monopod supports this move with a smaller footprint than a tripod.'), 'Monopod', flags
        return None, RequirementDraft(kind='stabilization', label='Support', status='not_required',
            epistemic='RECOMMENDED', resource_type='tripod',
            detail='This Shot does not need a specialised support.'), 'Whatever is already under the camera', flags

    # Lighting ----------------------------------------------------------------

    def _lighting(self, shot: dict[str, Any], brief: dict[str, Any] | None, size: str,
        constraints: set[str], solo: bool) -> tuple[str, str, dict[str, Any], RequirementDraft, list[dict[str, Any]]]:
        used: list[dict[str, Any]] = []
        tone = ' '.join((brief or {}).get('tone') or []) if brief else ''
        concept = (brief or {}).get('creative_concept') or ''
        product_shot = bool(shot.get('product_direction')) or 'product' in str(shot.get('purpose') or '').lower()
        if product_shot or size in ('macro', 'insert', 'extreme close-up'):
            intent = 'Soft, controlled light so the Product reads cleanly and the label stays legible.'
        elif 'tense' in tone or 'dramatic' in tone:
            intent = 'Shaped side light: bright on the subject, falling away behind them.'
        elif concept:
            intent = f'Support the Production look: {_clamp(concept, 160)}.'
        else:
            intent = 'Natural-looking light with the subject brighter than the background.'
        lights = self.setup.lights
        modifiers = self.setup.modifiers
        if 'available_light_only' in constraints or not lights:
            if lights and 'available_light_only' in constraints:
                detail = 'You asked for available light only, so the lights in Setup are unused here.'
            else:
                detail = 'Setup lists no light.'
            if modifiers or self.setup.of_type('stand'):
                budget = RequirementDraft(kind='light', label='Key light', status='substitute', epistemic='RECOMMENDED',
                    resource_type='light', ideal_name='One soft key light',
                    alternative='Bounce the window or an existing lamp with the modifier you own, and keep the subject close to it.',
                    detail=detail)
            else:
                budget = RequirementDraft(kind='light', label='Key light', status='unverified', epistemic='UNKNOWN',
                    resource_type='light', ideal_name='A controllable key light',
                    alternative='Shoot beside a window and turn off competing room lights; treat the result as unverified until you see it.',
                    detail=detail + ' Whether the room can be lit well enough cannot be verified from here.')
            return intent, ('Shoot beside the largest window, place the subject about a metre in, turn off competing '
                'practicals, and let the far side fall off. If it is too contrasty, bounce light back with anything white you own.'), {
                'subject': 'At the window, camera side of the room',
                'camera': 'Facing the subject, back to the room',
                'lights': [{'role': 'key', 'source': 'window or existing lamp', 'direction': 'side-on to the subject'}],
                'modifiers': [self.setup.name_of(item) for item in modifiers[:2]] or [],
                'direction': 'Single soft source, subject turned into it',
                'purpose': 'Keeps the light explainable and repeatable without owning a fixture.',
            }, budget, used
        one_light = 'one_light' in constraints or len(lights) == 1
        key = lights[0]
        used.append(key)
        modifier = modifiers[0] if modifiers else None
        key_line = f'Use your {self.setup.name_of(key)} as the key'
        if modifier:
            key_line += f' through the {self.setup.name_of(modifier)}'
        key_line += ', placed about 45 degrees camera-left and slightly above eye level'
        key_line += ', aimed so the brightest part of the face is toward the camera.' if size in ('close-up', 'medium close-up', 'extreme close-up') else '.'
        if one_light:
            detail = ('Your Setup has a single light, so this is a one-light plan: the key does the work and the room '
                'provides the rest.')
            # The one-light decision belongs in the plan the creator reads, not only in
            # the Setup-matching detail.
            key_line += ' This is a one-light plan: the single fixture does the work and the room provides the rest.'
            alternative = 'Add a white board or sheet opposite the key as fill only if the shadow side reads too dark.'
            status: RequirementStatus = 'substitute' if modifiers or self.setup.of_type('stand', 'accessory') else 'owned'
            requirement = RequirementDraft(kind='light', label='Key light', status=status, epistemic='REQUIRED',
                resource_type='light', resource_id=str(key['id']) if status == 'owned' else None,
                substitute_resource_id=None if status == 'owned' else str(key['id']),
                ideal_name='Key light plus fill',
                alternative=alternative if status == 'substitute' else '',
                detail=detail)
        else:
            fill = lights[1]
            used.append(fill)
            key_line += (f' Use your {self.setup.name_of(fill)} as a very light fill or as a background light '
                'so the subject separates from the wall.')
            requirement = RequirementDraft(kind='light', label='Key light', status='owned', epistemic='REQUIRED',
                resource_type='light', resource_id=str(key['id']),
                detail='Chosen from the lights you actually own for this intention.')
        if product_shot:
            key_line += (' For the Product, keep the light broad and slightly to the side so the label does not '
                'specular-reflect straight back into the lens.')
        return intent, key_line, {
            'subject': 'Where the blocking puts them',
            'camera': f'{SHOT_SIZE_LABEL.get(size, size)} on the chosen support',
            'lights': [{'role': 'key', 'resource': self.setup.name_of(key), 'direction': '45 degrees camera-left, slightly above eye level'}]
                + ([{'role': 'fill', 'resource': self.setup.name_of(used[1]), 'direction': 'opposite the key, far side'}] if len(used) > 1 else []),
            'modifiers': [self.setup.name_of(modifier)] if modifier else [],
            'direction': 'Key from camera-left, falloff behind the subject',
            'purpose': intent,
        }, requirement, used

    # Sound -------------------------------------------------------------------

    def _sound(self, shot: dict[str, Any], script_line: dict[str, Any] | None, constraints: set[str]) -> tuple[str, str, str, list[RequirementDraft]]:
        requirements: list[RequirementDraft] = []
        has_dialogue = bool(script_line) or 'dialogue' in str(shot.get('purpose') or '').lower()
        lavs = self.setup.of_type('microphone')
        wireless = self.setup.wireless
        recorder = self.setup.recorders
        if isinstance(script_line, dict) and script_line.get('kind') == 'dialogue':
            has_dialogue = True
        if not has_dialogue:
            return ('No sync sound needed on this Shot. Check the room for anything that will intrude on nearby Shots and '
                'capture room tone once for the Scene.',
                'Camera audio is enough here; it is scratch and reference only.',
                'Mark the take with a clap if you will sync anything later.', [])
        if lavs:
            mic = lavs[0]
            placement = ('Clip the lav about a hand-width below the collarbone, under the fabric but clear of it, and '
                'listen for clothing rustle before rolling.')
            recorder_line = (f'Record to your {self.setup.name_of(recorder[0])}' if recorder
                else 'Record to whatever recorder you own, or to the camera if that is all you have')
            if wireless:
                recorder_line += f' through the {self.setup.name_of(wireless[0])}'
            recorder_line += ', leaving the camera microphone running as scratch.'
            # Separate audio needs a sync strategy the editor can actually use.
            recorder_line += (' Sound is recorded separately, so clap once at the head of every take (or slate it) '
                'and keep the camera microphone running as the sync reference.')
            requirements.append(RequirementDraft(kind='microphone', label='Dialogue microphone', status='owned',
                epistemic='REQUIRED', resource_type='microphone', resource_id=str(mic['id']),
                detail='The lav is the primary dialogue source for this Shot.'))
            return (f'Primary: {self.setup.name_of(mic)} on the speaker. {placement}',
                f'{self.setup.name_of(mic)} is the primary source; keep the camera microphone as scratch.',
                recorder_line, requirements)
        if self.setup.of_type('microphone') or self.setup.of_type('recorder'):
            requirements.append(RequirementDraft(kind='microphone', label='Dialogue microphone', status='substitute',
                epistemic='RECOMMENDED', resource_type='microphone', ideal_name='Lavalier or shotgun microphone',
                detail='Setup has recording gear, but nothing suited to close dialogue.',
                alternative='Use the closest microphone you own within 30 cm of the speaker and keep the room quiet.'))
        else:
            requirements.append(RequirementDraft(kind='microphone', label='Dialogue microphone', status='missing',
                epistemic='REQUIRED', resource_type='microphone', ideal_name='Lavalier microphone',
                alternative=('Record the line on a second phone held just out of frame as a close microphone, or shoot '
                    'this Shot without sync dialogue and lay the line in later.'),
                detail='Setup lists no microphone or recorder.'))
        return ('Camera microphone only: usable as scratch, not as the final dialogue source. Keep the camera within a '
            'metre of the speaker and treat the room as part of the recording.',
            'Camera microphone as scratch audio.', 'Clap at the head of every take so a later replacement line can be synced.', requirements)

    # Solo and crew -----------------------------------------------------------

    def _crew(self, movement: str, moving: bool, size: str, lights_used: int, dialogue: bool,
        constraints: set[str], text: str) -> tuple[SoloFeasibility, list[str], list[str]]:
        wants_solo = 'solo' in constraints or any(word in (text or '').lower() for word in ('alone', 'myself', 'by myself'))
        roles: list[str] = []
        if moving and movement in ('push', 'pull', 'truck', 'tracking', 'orbit', 'arc', 'crane'):
            roles.append('Camera operator')
        if lights_used > 1:
            roles.append('Gaffer')
        if size in ('two shot', 'over the shoulder') and dialogue:
            roles.append('Second performer')
        if wants_solo:
            if moving:
                return 'solo_with_simplification', ['Operator (you)'], [
                    'You are alone and this Shot moves. Set the move as a repeatable tripod pan or let the subject move '
                    'through a locked frame, then pre-focus and roll several takes.']
            if lights_used > 1:
                return 'solo_with_simplification', ['Operator (you)'], ['You are alone, so light it with one fixture and let the room do the rest.']
            return 'solo', ['Operator (you)'], ['This Shot is genuinely one-person work: set the frame, mark focus, roll.']
        if moving and lights_used > 1:
            return 'second_person_recommended', roles or ['Camera operator'], [
                'Someone should hold the camera while you watch the performance and the light; doing both at once is '
                'where moving Shots usually fail.']
        if size in ('two shot', 'over the shoulder') and dialogue:
            return 'crew_required', ['Camera operator', 'Second performer'], [
                'A two-hander needs two people in frame plus someone on the camera to hold the eyeline.']
        if moving:
            return 'second_person_recommended', ['Camera operator'], ['A second person on camera makes this move repeatable.']
        return 'solo', ['Operator (you)'], ['Nothing in this Shot needs a second pair of hands.']

    # Safety ------------------------------------------------------------------

    def _safety(self, shot: dict[str, Any], text: str, constraints: set[str], movement: str) -> tuple[list[str], list[str], bool]:
        flags: list[str] = []
        notes: list[str] = []
        haystack = ' '.join([str(shot.get('title') or ''), str(shot.get('description') or ''), str(shot.get('action') or ''), text or '']).lower()
        for flag, needles in HIGH_RISK.items():
            if any(needle in haystack for needle in needles):
                flags.append(flag)
        signed_off = 'safer' in constraints
        if 'vehicle' in flags and any(phrase in haystack for phrase in ('driving', 'while driving', 'myself driving', 'i drive', 'alone')):
            flags.append('vehicle-while-driving')
            notes.append('Do not film while driving. Nothing in this plan asks you to operate a camera and a vehicle at the same time.')
            notes.append('Shoot the vehicle stationary with the camera secured on a mount, or have someone else drive while you are a passenger and the camera is fixed.')
        if 'drone' in flags:
            notes.append('Drone use needs current airspace rules, local permissions and, where required, a qualified operator. Setup listing a drone is not permission to fly.')
            notes.append('Check people and property below, wind, line of sight and site restrictions before take-off.')
        if 'heights' in flags:
            notes.append('Work at height only with a second person present and the camera secured; do not lean over an edge to get the frame.')
        if 'electricity' in flags:
            notes.append('Do not modify mains power, wiring or sockets. Use the fixtures and cables as intended by their manufacturer.')
        if 'traffic' in flags:
            notes.append('Shoot traffic from behind a barrier, not from the roadway, and keep a spotter facing the traffic.')
        if 'fire' in flags or 'weapon' in flags or 'stunt' in flags:
            notes.append('This Shot touches fire, weapons or stunts. That needs a licensed specialist on set; this plan is planning guidance, not a substitute.')
        if 'water' in flags:
            notes.append('Water brings slip and immersion risk: keep the camera secured and never wade in alone.')
        if 'crowd' in flags:
            notes.append('In a crowd, keep gear within reach, get permission where needed, and agree with the people who may end up in frame.')
        if movement == 'drone' and 'drone' not in flags:
            flags.append('drone')
        if signed_off:
            notes.append('You asked for the safest version, so this plan avoids a moving camera, ladders and any shot that needs a second person.')
        return _clean_list(flags, 12, 60), _clean_list(notes, 12, 400), 'vehicle-while-driving' in flags

    # The plan ----------------------------------------------------------------

    def direct(self, *, shot: dict[str, Any], scene: dict[str, Any], production: dict[str, Any],
        brief: dict[str, Any] | None = None, script_line: dict[str, Any] | None = None,
        text: str = '', declared_constraints: list[str] | None = None) -> tuple[RealPlanDraft, list[RequirementDraft], list[AlternativeDraft]]:
        constraints = parse_constraints(text, declared_constraints)
        size = shot_size_from(shot)
        movement = movement_from(shot, constraints)
        moving = movement in MOVING_SHOTS
        if 'simplify' in constraints or 'faster' in constraints:
            movement = 'locked'
            moving = False
        requirements: list[RequirementDraft] = []
        alternatives: list[AlternativeDraft] = []

        camera, camera_requirement, camera_extra = self._choose_camera(shot, size, movement, constraints)
        requirements.append(camera_requirement)
        requirements.extend(camera_extra)
        lens, lens_requirement, perspective = self._choose_lens(camera, size, constraints)
        requirements.append(lens_requirement)
        _, support_requirement, stabilization, support_flags = self._choose_support(movement, constraints)
        requirements.append(support_requirement)
        chosen_focal = _focal_length(lens) if lens else None

        intent, lighting_plan, diagram, light_requirement, lights_used = self._lighting(shot, brief, size, constraints, 'solo' in constraints)
        requirements.append(light_requirement)
        sound_plan, microphone_plan, sync_strategy, sound_requirements = self._sound(shot, script_line, constraints)
        requirements.extend(sound_requirements)

        solo_feasibility, crew_roles, crew_notes = self._crew(movement, moving, size, len(lights_used), bool(script_line),
            constraints, text)
        if solo_feasibility != 'solo':
            requirements.append(RequirementDraft(kind='crew', label='Crew', status='unverified', epistemic='RECOMMENDED',
                ideal_name=', '.join(crew_roles) or 'Second person',
                detail='Marked unverified because nobody is booked in Setup; it is a working requirement, not a booking.',
                alternative='If nobody is free, simplify the Shot rather than attempting it alone.'))

        safety_flags, safety_notes, blocked = self._safety(shot, text, constraints, movement)
        # A platform the plan cannot verify (a drone) is a safety consideration too.
        safety_flags = _clean_list(safety_flags + support_flags, 12, 60)
        complexity: PlanComplexity = ('complex' if (moving and len(lights_used) > 1) or solo_feasibility == 'crew_required'
            else 'moderate' if moving or len(lights_used) > 1 or size in ('macro', 'insert')
            else 'quick')

        product_shot = bool(shot.get('product_direction')) or 'product' in str(shot.get('purpose') or '').lower()
        product_direction = ''
        if product_shot:
            product_direction = ('Keep the label square to the lens. Light the Product broadly from the side so the '
                'surface does not flare back, and keep hands off the logo. Shoot one extra take with the Product '
                'held for two seconds longer than you need, so the edit has room.')
        blocking = self._blocking(shot, size, movement)
        performance = self._performance(shot, script_line)
        if crew_notes and solo_feasibility != 'solo':
            blocking = blocking + ' ' + ' '.join(crew_notes)
        environment_requirements = _clean_list([
            'A surface the camera can sit on or beside' if size in ('macro', 'insert', 'close-up', 'extreme close-up') else '',
            'Enough room behind the camera for the framing'
                if size in ('wide', 'full', 'medium', 'two shot') or (chosen_focal is not None and chosen_focal >= 65) else '',
            'A power point within reach of the light' if lights_used else '',
            'Background that supports the Story beat rather than distracting from it',
        ])
        location_requirements = _clean_list([
            'Space behind the camera for this framing' if size in ('wide', 'full', 'medium', 'two shot')
                or (chosen_focal is not None and chosen_focal >= 65) else '',
            'Controllable window or the ability to work without daylight',
            'Space to place the key light and still stay out of frame' if lights_used else '',
            'Background noise low enough for the microphone plan',
            'Permission to shoot here',
        ])
        if 'lost_location' in constraints:
            location_requirements = _clean_list(location_requirements + [
                'Original location unavailable: the plan above is written to be repeatable in a smaller room.'])
            alternatives.append(AlternativeDraft(kind='lowest_equipment', label='Smallest viable room',
                description='Run the same Shot against the tightest wall you have, with the subject a step from the camera and the key close in.',
                expected_impact='Background compresses and the light falls off faster.', tradeoffs=['Less depth in the frame']))

        expected = shot.get('planned_duration_ms')
        plan_status: PlanStatus = 'safety_blocked' if blocked else 'draft'
        readiness_note = ''
        if blocked:
            readiness_note = 'Blocked for safety: this Shot as written needs a solution that does not put you in danger.'
        plan = RealPlanDraft(
            plan_status=plan_status, readiness_note=readiness_note, complexity=complexity, complexity_is_estimate=True,
            generated_by='deterministic',
            camera_resource_id=str(camera['id']) if camera else None,
            lens_resource_id=str(lens['id']) if lens else None,
            shot_size=SHOT_SIZE_LABEL.get(size, size), camera_position=self._camera_position(size, movement),
            camera_height='Eye level' if size in ('medium', 'medium close-up', 'close-up', 'over the shoulder', 'two shot') else 'Chest height' if size in ('wide', 'full', 'cowboy') else 'Just above the surface',
            camera_angle='Frontal to the subject' if size not in ('over the shoulder',) else 'About 30 degrees off the subject’s nose',
            framing=f"{SHOT_SIZE_LABEL.get(size, size)}: {_clamp(str(shot.get('subject') or shot.get('title') or 'the subject'), 200)}",
            composition='Leave space in the direction the subject looks or moves.',
            perspective_note=perspective,
            movement=movement, movement_purpose=self._movement_purpose(shot, movement),
            stabilization=stabilization,
            capture_fps='60 fps or higher capture for slow motion' if 'slow' in str(shot.get('movement') or '').lower() else '24 fps for normal-speed work',
            delivery_fps='24 fps timeline',
            shutter='1/48 s (180 degree) starting point' if 'slow' not in str(shot.get('movement') or '').lower() else '1/120 s or faster capture shutter starting point',
            aperture=SHOT_SIZE_DOF.get(size, 'f/2.8-f/4 starting point'),
            iso_range='Start at the camera’s base ISO and raise only as far as the shot needs.',
            white_balance=self._white_balance(intent, lights_used),
            nd_filter=f"Use your {self.setup.name_of(self.setup.filters[0])} if the aperture starting point cannot hold in daylight" if self.setup.filters else '',
            exposure_note='These are starting points, not settings: adjust for exposure and for the depth of field the Shot needs.',
            focus_strategy=self._focus(size, movement, solo_feasibility),
            depth_of_field='Hold the label and the eyes in focus; let the background fall away only if the Story beat needs it.',
            lighting_intent=intent, lighting_plan=lighting_plan, lighting_diagram=diagram,
            blocking=blocking, performance=performance, product_direction=product_direction,
            sound_plan=sound_plan, microphone_plan=microphone_plan, sync_strategy=sync_strategy,
            solo_feasibility=solo_feasibility, crew_roles=_clean_list(crew_roles, 12, 60),
            environment_requirements=environment_requirements, location_requirements=location_requirements,
            safety_notes=safety_notes, safety_flags=safety_flags,
            editorial_intent=self._editorial(shot),
            setup_steps=_clean_list(self._setup_steps(size, movement, bool(lights_used), bool(lens))),
            capture_checklist=_clean_list(CAPTURE_CHECKLIST + (['Product wiped and positioned'] if product_shot else [])
                + (['Room tone recorded'] if sound_requirements else [])),
            expected_duration_ms=int(expected) if isinstance(expected, int) else None,
        )
        alternatives.extend(self._alternatives(size, movement, constraints, bool(lights_used), bool(self.setup.microphones)))
        # The plan's own status reflects the requirement facts we just established.
        if not blocked:
            plan.plan_status = self._derive_status(requirements)
            if plan.plan_status == 'needs_decision' and not plan.readiness_note:
                plan.readiness_note = 'Some Setup items are unverified; confirm them before the shoot day.'
            if plan.plan_status == 'missing_resource' and not plan.readiness_note:
                missing = [item.label for item in requirements if item.status == 'missing']
                plan.readiness_note = f"Missing from Setup: {', '.join(missing)}."
        return plan, requirements, alternatives

    def _derive_status(self, requirements: list[RequirementDraft]) -> PlanStatus:
        if any(item.status == 'missing' for item in requirements):
            return 'missing_resource'
        if any(item.status == 'unverified' for item in requirements):
            return 'needs_decision'
        if any(item.status == 'substitute' for item in requirements):
            return 'ready_with_substitution'
        return 'ready'

    def _camera_position(self, size: str, movement: str) -> str:
        if size in ('macro', 'insert', 'extreme close-up'):
            return 'Close in, with the lens roughly a hand-span from the subject, squared to the surface.'
        if size in ('wide', 'full', 'extreme wide'):
            return 'Well back from the subject, with enough room behind you for the framing.'
        if size == 'over the shoulder':
            return 'Behind and slightly to one side of the first speaker, seeing past their shoulder.'
        return 'About two metres from the subject at eye level, with room to step in or out.'

    def _movement_purpose(self, shot: dict[str, Any], movement: str) -> str:
        relationship = str(shot.get('story_relationship') or shot.get('purpose') or '').strip()
        if movement == 'locked':
            return ('A locked frame lets the performance and the Product carry the Shot' +
                (f': {_clamp(relationship, 160)}.' if relationship else '.'))
        return (f'{movement.title()} builds pressure through the beat' + (f': {_clamp(relationship, 160)}.' if relationship else '.'))

    def _white_balance(self, intent: str, lights_used: list[dict[str, Any]]) -> str:
        if lights_used:
            return 'Match the key light (about 5600 K for daylight-balanced LEDs); set it deliberately rather than leaving Auto WB.'
        if 'window' in intent.lower():
            return 'Daylight, about 5600 K, and flag or switch off any warm room light fighting it.'
        return 'Set one value for the whole Scene and keep it; do not leave Auto WB across coverage.'

    def _focus(self, size: str, movement: str, solo_feasibility: str) -> str:
        base = ('Focus on the eyes, or on the label when the Product is the subject. Pre-focus on a mark and hold it '
            'rather than chasing focus during the take.')
        if size in ('macro', 'insert', 'extreme close-up'):
            base = ('At this distance the depth of field is very thin: set focus manually on the exact detail, then do '
                'not touch the camera. Roll several takes and check each one.')
        if movement in MOVING_SHOTS:
            base += ' With a moving camera, pull focus between two marked positions rather than tracking continuously.'
        if solo_feasibility in ('solo', 'solo_with_simplification'):
            base += ' Working alone, prefer a slightly wider aperture of light and a slightly deeper focus pull so a small miss still reads.'
        return base

    def _blocking(self, shot: dict[str, Any], size: str, movement: str) -> str:
        action = str(shot.get('action') or shot.get('description') or '').strip()
        steps = ['Start the subject on their mark, settled, with hands clear of the Product.']
        if action:
            steps.append(_clamp(action, 600))
        steps.append('Give the beat time to land before the cut: hold the last frame for a moment after the action finishes.')
        if size in ('close-up', 'medium close-up', 'extreme close-up'):
            steps.append('Keep the eyeline just off the lens so the Shot reads as a person rather than an address to camera.')
        if movement in MOVING_SHOTS:
            steps.append('Mark the start and end of the move on the floor; repeat takes from the same marks so the edit can cut between them.')
        return ' '.join(steps)

    def _performance(self, shot: dict[str, Any], script_line: dict[str, Any] | None) -> str:
        if isinstance(script_line, dict):
            intention = script_line.get('intention') or ''
            delivery = script_line.get('delivery') or ''
            line = script_line.get('content') or ''
            parts = ['Play the intention, not the words.']
            if line:
                parts.append(f'On “{_clamp(str(line), 120)}”, let the line land on the beat rather than rushing to the end.')
            if intention:
                parts.append(f'Intention: {_clamp(str(intention), 200)}.')
            if delivery:
                parts.append(f'Delivery: {_clamp(str(delivery), 200)}.')
            parts.append('Hold one beat after the last word before the cut so the edit has somewhere to land.')
            return ' '.join(parts)
        return ('Start restrained, hold one beat, then let the response arrive — the change is what the Shot is for. '
            'Keep the hands deliberate and let the face do the last part of the work.')

    def _editorial(self, shot: dict[str, Any]) -> str:
        purpose = str(shot.get('purpose') or '').lower()
        for intent, needles in (('establishing', ('establish',)), ('insert', ('insert', 'product', 'detail')),
            ('reaction', ('reaction', 'react', 'emotional')), ('transition', ('transition', 'wipe')),
            ('cutaway', ('cutaway',)), ('master', ('master',))):
            if any(needle in purpose for needle in needles):
                return intent
        return 'coverage'

    def _setup_steps(self, size: str, movement: str, has_light: bool, has_lens: bool) -> list[str]:
        steps = ['Set the camera on its support and level it.']
        if has_lens:
            steps.append('Fit the chosen lens and set the framing by moving the camera, not by zooming.')
        steps.append('Set white balance for the dominant source before rolling.')
        if has_light:
            steps.append('Place the key light and modifier, then stand in the subject’s position and check for spill and reflections.')
        if movement in MOVING_SHOTS:
            steps.append('Walk the move once without recording and mark the floor, so every take travels the same path.')
        steps.append('Run one rehearsal take, check focus and audio, then roll.')
        if size in ('macro', 'insert', 'extreme close-up'):
            steps.append('Clean the surface and the lens-side of the Product; fingerprints read at this size.')
        return steps

    def _alternatives(self, size: str, movement: str, constraints: set[str],
        has_light: bool, has_mic: bool) -> list[AlternativeDraft]:
        options: list[AlternativeDraft] = []
        if movement in MOVING_SHOTS:
            options.append(AlternativeDraft(kind='fastest', label='Locked and let the subject move',
                description='Put the camera on a tripod and let the action travel through the frame instead of moving the camera.',
                expected_impact='Same story beat, no travel to repeat.', tradeoffs=['Less momentum in the frame']))
        if 'phone_only' not in constraints and self.setup.phone_cameras:
            options.append(AlternativeDraft(kind='lowest_equipment', label='Shoot it on the phone',
                description='Use the phone camera with its exposure and focus locked, held on the support you already own.',
                expected_impact='Faster to set up, smaller files, less control over depth of field.', tradeoffs=['Less background separation']))
        if has_light:
            options.append(AlternativeDraft(kind='available_light', label='Available light only',
                description='Turn the fixture off and shoot the Shot beside the window, bouncing light back only if the shadow side is too dark.',
                expected_impact='Faster and quieter, with less control over contrast.', tradeoffs=['Weather and time of day now matter']))
        options.append(AlternativeDraft(kind='solo', label='Fully solo version',
            description='Keep the frame locked and the setup to one fixture, pre-focus on a mark and roll several takes.',
            expected_impact='No second person needed.', tradeoffs=['Fewer takes with a moving subject']))
        options.append(AlternativeDraft(kind='safest', label='Safest version',
            description='Shoot the beat from a position you can hold safely: no heights, no traffic, no camera in a moving vehicle.',
            expected_impact='Protects the Shot and the person shooting it.', tradeoffs=['May lose the more dramatic angle']))
        if size in ('close-up', 'medium close-up', 'extreme close-up', 'insert', 'macro'):
            options.append(AlternativeDraft(kind='substitute', label='Cover it with a wider Shot',
                description='Shoot a medium version and cut into it, so a focus or Product problem does not cost the Scene.',
                expected_impact='More coverage to cut with.', tradeoffs=['The intended intimacy is diluted']))
        if not has_mic:
            options.append(AlternativeDraft(kind='ai_foundation', label='Plan to replace the audio',
                description='Treat the on-camera audio as scratch and plan to record the line separately, or generate it later in AI creation.',
                expected_impact='Removes microphone pressure on the shoot day.', tradeoffs=['Needs a sync pass in the edit']))
        return options


# --- Persistence --------------------------------------------------------------


class RealProductionRepository:
    """Reads and writes the Real execution layer through the guarded RPCs."""

    def __init__(self, gateway: SupabaseGateway) -> None:
        self.gateway = gateway

    async def surface(self, workspace_id: UUID, production_id: UUID, token: str, *,
        expected_revision: int | None = None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('real_execution_surface', token=token, layer='Real production', json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'expected_production_revision': expected_revision,
        })

    async def detail(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str) -> dict[str, Any]:
        data = await self.gateway.rpc_detailed('real_shot_detail', token=token, layer='Real production', json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id),
        })
        if not data or not data.get('shot'):
            raise AppError('SHOT_NOT_FOUND', 'not_found', 'That Shot is unavailable in this Production.', 404)
        return data

    async def save_plan(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str,
        body: SaveRealPlanRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('save_real_plan', token=token, layer='Real production', json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'expected_shot_revision': body.expected_shot_revision,
            'plan': real_plan_payload(body.plan),
            'requirements': [requirement_payload(item) for item in body.requirements],
            'alternatives': [alternative_payload(item) for item in body.alternatives],
            'operation_id': body.operation_id,
        })

    async def set_approval(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str,
        body: PlanApprovalRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('set_real_plan_approval', token=token, layer='Real production', json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'desired_approval': body.approval,
            'expected_shot_revision': body.expected_shot_revision,
        })

    async def set_lock(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str,
        body: PlanLockRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('set_real_plan_lock', token=token, layer='Real production', json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'locked': body.locked,
            'expected_shot_revision': body.expected_shot_revision,
        })

    async def set_capture(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str,
        body: CaptureStateRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('set_shot_capture_state', token=token, layer='Real production', json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'status': body.status, 'notes': body.notes,
            'expected_revision': body.expected_revision,
        })

    async def save_take(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str,
        body: TakeRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('save_shot_take', token=token, layer='Real production', json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'take': take_payload(body), 'expected_revision': body.expected_revision,
        })

    async def delete_take(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, take_id: UUID,
        token: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('delete_shot_take', token=token, layer='Real production', json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'target_take': str(take_id),
        })

    async def record_deviation(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str,
        body: DeviationRequest) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('record_shot_deviation', token=token, layer='Real production', json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'deviation': deviation_payload(body),
        })

    async def setup_resources(self, workspace_id: UUID, token: str) -> list[dict[str, Any]]:
        rows = await self.gateway.request('GET', '/rest/v1/production_resources', token=token, schema=True, params={
            'workspace_id': f'eq.{workspace_id}', 'lifecycle': 'eq.active',
            'select': 'id,resource_type,name,manufacturer,model,mount,stabilization,metadata',
            'order': 'resource_type,name', 'limit': '300',
        })
        return rows if isinstance(rows, list) else []
