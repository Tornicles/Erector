"""Prompt 7 AI Creation engine: Model Router, Prompt Compiler, Hybrid Advisor.

Everything here is deterministic and provider-neutral. There is no vendor SDK, no
hard-wired model name and no invented capability: the engine ranks only the models the
workspace declared, and it treats every capability fact it was not given as UNKNOWN.

The database is the authority on capability truth. This engine mirrors the same rules so
it can rank and explain before anything is stored, and `save_ai_plan` re-checks the
verdict in SQL, so a recommendation can never become a stored fact the database disagrees
with.

Reference material is untrusted input. Reference notes, transcripts and provider payloads
are data: they are sanitised and placed only in reference/data sections, never in an
instruction section.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.domain.ai_creation import (
    DROPPABLE_SECTIONS,
    IDENTITY_TRUTH,
    PROMPT_SECTION_ORDER,
    CapabilityState,
    FidelityImportance,
)

# --- Untrusted input (§101). Text from a reference never becomes an instruction. ------

INJECTION_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r'(?i)\bignore\s+(all\s+|the\s+)?(previous|prior|above|earlier)\s+instructions?\b'),
    re.compile(r'(?i)\b(system|developer|assistant)\s*(prompt|message|role)?\s*:'),
    re.compile(r'(?i)\bdisregard\s+(all\s+|the\s+)?(previous|prior|system)\b'),
    re.compile(r'(?i)\byou\s+are\s+now\s+(a|an|the)\b'),
    re.compile(r'(?i)\bnew\s+(system\s+)?instructions?\b'),
    re.compile(r'(?i)\boverride\s+(the\s+)?(rules|policy|polic(y|ies)|constraints)\b'),
)

MAX_UNTRUSTED_LENGTH = 400


def sanitise_untrusted(text: Any, *, limit: int = MAX_UNTRUSTED_LENGTH) -> str:
    """Keep reference text as data: instruction-like content is removed, not obeyed."""

    if not isinstance(text, str):
        return ''
    kept: list[str] = []
    for line in text.replace('\r', '\n').split('\n'):
        candidate = line.strip()
        if not candidate:
            continue
        if any(pattern.search(candidate) for pattern in INJECTION_PATTERNS):
            continue
        kept.append(candidate)
        if sum(len(item) + 1 for item in kept) >= limit:
            break
    return ' '.join(kept)[:limit]


def has_injection_attempt(text: Any) -> bool:
    if not isinstance(text, str):
        return False
    return any(pattern.search(text) for pattern in INJECTION_PATTERNS)


# --- What a Shot needs from a model (§8/§19). ---------------------------------------


@dataclass(frozen=True)
class AiRequirements:
    """The capability a Shot actually requires, derived from production context."""

    operation: str = 'video'
    reference_count: int = 0
    must_reference_count: int = 0
    needs_first_frame: bool = False
    needs_last_frame: bool = False
    needs_audio: bool = False
    needs_camera_control: bool = False
    needs_negative_prompt: bool = False
    duration_ms: int | None = None
    aspect_ratio: str = ''
    identity_importance: FidelityImportance = 'flexible'
    product_importance: FidelityImportance = 'flexible'
    motion_complexity: str = 'simple'
    negative_constraint_count: int = 0


@dataclass(frozen=True)
class CapabilityVerdict:
    state: CapabilityState
    blocking: tuple[str, ...] = ()
    partial: tuple[str, ...] = ()
    reasons: tuple[str, ...] = ()
    requires_connection: bool = False

    @property
    def usable(self) -> bool:
        return not self.blocking and self.state in ('SUPPORTED', 'PARTIALLY SUPPORTED')


@dataclass(frozen=True)
class ModelProfile:
    """A declared model. Every field is what the workspace said, or UNKNOWN."""

    model_profile_id: str
    provider_key: str
    model_key: str
    label: str = ''
    operation: str = 'video'
    capability_state: CapabilityState = 'UNKNOWN'
    supports_image_reference: bool = False
    max_reference_images: int | None = None
    supports_first_frame: bool = False
    supports_last_frame: bool = False
    supports_seed: bool = False
    supports_negative_prompt: bool = False
    supports_camera_control: bool = False
    supports_audio: bool = False
    max_duration_ms: int | None = None
    aspect_ratios: tuple[str, ...] = ()
    resolutions: tuple[str, ...] = ()
    cost_unit: str = ''
    cost_known: bool = False
    cost_amount: float | None = None
    cost_currency: str = ''
    speed_note: str = ''
    identity_note: str = ''
    product_fidelity_note: str = ''
    availability: str = 'unknown'
    connected: bool = False
    # Declared per model in Setup (for example the provider's prompt format and length budget).
    capability_notes: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_catalog(cls, row: dict[str, Any]) -> ModelProfile:
        return cls(
            model_profile_id=str(row.get('model_profile_id') or ''),
            provider_key=str(row.get('provider_key') or ''),
            model_key=str(row.get('model_key') or ''),
            label=str(row.get('label') or ''),
            operation=str(row.get('operation') or 'video'),
            capability_state=row.get('capability_state') or 'UNKNOWN',
            supports_image_reference=bool(row.get('supports_image_reference')),
            max_reference_images=row.get('max_reference_images'),
            supports_first_frame=bool(row.get('supports_first_frame')),
            supports_last_frame=bool(row.get('supports_last_frame')),
            supports_seed=bool(row.get('supports_seed')),
            supports_negative_prompt=bool(row.get('supports_negative_prompt')),
            supports_camera_control=bool(row.get('supports_camera_control')),
            supports_audio=bool(row.get('supports_audio')),
            max_duration_ms=row.get('max_duration_ms'),
            aspect_ratios=tuple(row.get('aspect_ratios') or ()),
            resolutions=tuple(row.get('resolutions') or ()),
            cost_unit=str(row.get('cost_unit') or ''),
            cost_known=bool(row.get('cost_known')),
            cost_amount=row.get('cost_amount'),
            cost_currency=str(row.get('cost_currency') or ''),
            speed_note=str(row.get('speed_note') or ''),
            identity_note=str(row.get('identity_note') or ''),
            product_fidelity_note=str(row.get('product_fidelity_note') or ''),
            availability=str(row.get('availability') or 'unknown'),
            connected=bool(row.get('connected')),
            capability_notes=dict(row.get('capability_notes') or {}),
        )


def capability_verdict(profile: ModelProfile, requirements: AiRequirements) -> CapabilityVerdict:
    """The same rules the database enforces, so a recommendation is never fiction."""

    blocking: list[str] = []
    partial: list[str] = []
    reasons: list[str] = []
    state: CapabilityState = profile.capability_state
    requires_connection = profile.capability_state == 'REQUIRES CONNECTION'

    if profile.capability_state == 'UNKNOWN':
        reasons.append("This model's capability is unknown to TONDE. Declare it in Setup before relying on it.")
    if profile.capability_state == 'UNSUPPORTED':
        reasons.append('This model is declared as not supporting the operation this Shot needs.')
        return CapabilityVerdict('UNSUPPORTED', ('This model is declared as not supporting the operation this Shot needs.',),
            (), tuple(reasons), requires_connection)
    if requires_connection and not profile.connected:
        # §12: knowing a model and being connected to it are different facts. A model that needs a
        # connection TONDE does not have must never be recommended as if it were usable.
        message = 'This model needs a provider connection that is not configured for this workspace yet.'
        reasons.append(message)
        return CapabilityVerdict('REQUIRES CONNECTION', (message,), (), tuple(reasons), True)
    if profile.availability == 'deprecated':
        reasons.append('This model is declared as deprecated, so future generation should route elsewhere.')
        blocking.append('This model is declared as deprecated.')

    if requirements.must_reference_count > 0:
        if not profile.supports_image_reference:
            message = 'Reference images are required and this model does not accept image references.'
            reasons.append(message)
            blocking.append(message)
        elif profile.max_reference_images is not None and requirements.must_reference_count > profile.max_reference_images:
            partial.append(f'{requirements.must_reference_count} required references exceed the '
                f'{profile.max_reference_images} this model accepts; TONDE will select the strongest.')

    if requirements.aspect_ratio and profile.aspect_ratios and requirements.aspect_ratio not in profile.aspect_ratios:
        message = (f'The Production delivers {requirements.aspect_ratio} and this model does not list '
            'that aspect ratio.')
        reasons.append(message)
        blocking.append(message)

    if requirements.needs_first_frame:
        if profile.supports_first_frame:
            partial.append('First frame is supported.')
        else:
            message = 'The Shot specifies a first frame and this model does not accept one.'
            reasons.append(message)
            state = 'UNSUPPORTED'

    if requirements.needs_last_frame:
        if profile.supports_last_frame:
            partial.append('Last frame is supported.')
        else:
            message = 'The Shot specifies a last frame and this model does not accept one.'
            reasons.append(message)
            state = 'UNSUPPORTED'

    if requirements.needs_audio:
        if profile.supports_audio:
            partial.append('Audio is generated with the Shot.')
        else:
            reasons.append('The Shot needs audio and this model does not generate audio.')
            state = 'UNSUPPORTED'

    if requirements.duration_ms is not None and profile.max_duration_ms is not None \
            and requirements.duration_ms > profile.max_duration_ms:
        partial.append(f'This model generates up to {profile.max_duration_ms} ms, so the Shot needs an '
            'extension or split.')

    if requirements.needs_negative_prompt and not profile.supports_negative_prompt:
        partial.append('Negative constraints are expressed in the prompt wording because this model has '
            'no negative-prompt field.')

    if requirements.needs_camera_control and not profile.supports_camera_control:
        partial.append('Camera movement is described in words because this model exposes no camera control.')

    if blocking:
        return CapabilityVerdict('UNSUPPORTED', tuple(blocking), tuple(partial), tuple(reasons), requires_connection)
    if state == 'SUPPORTED' and (partial or requirements.identity_importance != 'flexible'):
        if partial:
            state = 'PARTIALLY SUPPORTED'
    if profile.capability_state == 'UNKNOWN':
        state = 'UNKNOWN'
    elif profile.capability_state == 'REQUIRES CONNECTION':
        state = 'REQUIRES CONNECTION'
    elif profile.capability_state == 'PARTIALLY SUPPORTED':
        state = 'PARTIALLY SUPPORTED'
    return CapabilityVerdict(state, (), tuple(partial), tuple(reasons), requires_connection)


# --- The Model Router (§8, §16, §17, §18). -----------------------------------------

MANUAL_EXPORT_OPTION = 'MANUAL EXPORT OPTION'


@dataclass(frozen=True)
class RoutingChoice:
    kind: str
    model_profile_id: str | None
    provider_key: str
    model_key: str
    label: str
    reason: str
    cost_state: str = 'unknown'
    cost_amount: float | None = None
    cost_currency: str = ''


@dataclass(frozen=True)
class RoutingDecision:
    recommended: RoutingChoice | None
    fallback: RoutingChoice | None
    alternatives: tuple[RoutingChoice, ...] = ()
    excluded: tuple[dict[str, Any], ...] = ()
    reasoning: tuple[str, ...] = ()
    manual_export: RoutingChoice | None = None
    connection_required: bool = False

    @property
    def needs_model(self) -> bool:
        return self.recommended is None and not self.connection_required


def _cost_choice(profile: ModelProfile) -> tuple[str, float | None, str]:
    if profile.cost_known and profile.cost_amount is not None and profile.cost_currency:
        return 'known', profile.cost_amount, profile.cost_currency
    # Never a number TONDE does not have. Unknown stays unknown.
    return 'unknown', None, ''


def _score(profile: ModelProfile, requirements: AiRequirements,
    verdict: CapabilityVerdict) -> tuple[Any, ...]:
    """Deterministic ranking. Identity and reference adherence gate before price.

    Cost is the LAST key, and it is only reached by models that already satisfy the
    Shot's hard capability needs. A cheap text-only model can therefore never outrank a
    reference-capable one for a Character-heavy Shot.
    """

    reference_ok = 1 if (requirements.must_reference_count == 0 or profile.supports_image_reference) else 0
    identity = 1 if requirements.identity_importance == 'critical' and profile.identity_note else 0
    product = 1 if requirements.product_importance != 'flexible' and profile.product_fidelity_note else 0
    duration_fit = 1 if (requirements.duration_ms is None or profile.max_duration_ms is None
        or requirements.duration_ms <= profile.max_duration_ms) else 0
    aspect_fit = 1 if (not requirements.aspect_ratio or not profile.aspect_ratios
        or requirements.aspect_ratio in profile.aspect_ratios) else 0
    declared_strength = 2 if profile.capability_state == 'SUPPORTED' else (1 if profile.capability_state == 'PARTIALLY SUPPORTED' else 0)
    connected = 1 if profile.connected else 0
    # Cost is the LAST key, so it only orders models that already tie on every capability key.
    # A known price outranks an unknown one, and among known prices the lower amount wins. An
    # unknown price is never treated as free, and never as infinite dollars either — it simply
    # cannot win a cost tie-break against a model whose price you declared.
    amount = profile.cost_amount
    known_price = bool(profile.cost_known and amount is not None)
    cost_key = (1 if known_price else 0, -float(amount or 0.0) if known_price else 0.0)
    return (1 if verdict.usable else 0, reference_ok, identity, product, duration_fit, aspect_fit,
        declared_strength, connected, cost_key, -int(len(verdict.partial)))


class ModelRouter:
    """Chooses a model from declared facts, and says why in one sentence (§17)."""

    def route(self, requirements: AiRequirements, profiles: list[ModelProfile],
        preferences: dict[str, Any] | None = None) -> RoutingDecision:
        preferences = preferences or {}
        only_connected = bool(preferences.get('only_connected'))
        prefer_lower_cost = bool(preferences.get('prefer_lower_cost'))
        ready: list[tuple[tuple[Any, ...], ModelProfile, CapabilityVerdict]] = []
        # Declared models that cannot do everything the Shot needs. They are never preferred
        # over one that can, and when nothing better exists the limitation is stated outright.
        degraded: list[tuple[tuple[Any, ...], ModelProfile, CapabilityVerdict]] = []
        excluded: list[dict[str, Any]] = []

        for profile in profiles:
            verdict = capability_verdict(profile, requirements)
            if verdict.blocking:
                excluded.append({'model_profile_id': profile.model_profile_id, 'provider_key': profile.provider_key,
                    'model_key': profile.model_key, 'state': verdict.state, 'reasons': list(verdict.blocking)})
                continue
            if profile.capability_state == 'UNSUPPORTED':
                excluded.append({'model_profile_id': profile.model_profile_id, 'provider_key': profile.provider_key,
                    'model_key': profile.model_key, 'state': 'UNSUPPORTED', 'reasons': list(verdict.reasons)})
                continue
            if verdict.state == 'UNKNOWN':
                excluded.append({'model_profile_id': profile.model_profile_id, 'provider_key': profile.provider_key,
                    'model_key': profile.model_key, 'state': 'UNKNOWN', 'reasons': list(verdict.reasons)})
                continue
            if only_connected and not profile.connected:
                excluded.append({'model_profile_id': profile.model_profile_id, 'provider_key': profile.provider_key,
                    'model_key': profile.model_key, 'state': 'REQUIRES CONNECTION',
                    'reasons': ['You asked to use only models you have connected.']})
                continue
            bucket = ready if verdict.usable else degraded
            bucket.append((_score(profile, requirements, verdict), profile, verdict))

        chosen_degraded = False
        if not ready and degraded:
            # Something is better than nothing, but it is offered with the limitation attached, not hidden.
            ready = degraded
            chosen_degraded = True

        if not ready:
            needs_connection = any(item['state'] == 'REQUIRES CONNECTION' for item in excluded)
            return RoutingDecision(
                recommended=None, fallback=None, excluded=tuple(excluded),
                reasoning=('No declared model can perform this Shot yet. Declare a model you own in Setup, '
                    'or export the prompt and run it yourself.',),
                manual_export=self.manual_export_choice(requirements), connection_required=needs_connection)

        ready.sort(key=lambda item: item[0], reverse=True)
        best_score, best, best_verdict = ready[0]

        def choice(kind: str, profile: ModelProfile, reason: str) -> RoutingChoice:
            cost_state, amount, currency = _cost_choice(profile)
            return RoutingChoice(kind=kind, model_profile_id=profile.model_profile_id,
                provider_key=profile.provider_key, model_key=profile.model_key,
                label=profile.label or profile.model_key, reason=reason,
                cost_state=cost_state, cost_amount=amount, cost_currency=currency)

        reasons: list[str] = []
        if requirements.must_reference_count > 0:
            reasons.append('This Shot requires image-reference adherence, so reference support decided the choice.')
        if requirements.identity_importance == 'critical':
            reasons.append('Character identity matters most here, so a model with a declared identity strength wins.')
        if requirements.product_importance != 'flexible':
            reasons.append('Product fidelity matters here, so a model with declared product fidelity wins.')
        if requirements.duration_ms is not None:
            reasons.append(f'The Shot runs {requirements.duration_ms} ms, so duration fit was checked first.')
        if not reasons:
            reasons.append('Chosen from the models you declared, on declared capability rather than price alone.')
        if prefer_lower_cost:
            # An explicit creator request outranks the ranking, but only among models that can do the Shot.
            priced = [item for item in ready if item[1].cost_known and item[1].cost_amount is not None]
            if priced:
                chosen = min(priced, key=lambda item: item[1].cost_amount or 0.0)
                if chosen[1].model_profile_id != best.model_profile_id:
                    best, best_verdict = chosen[1], chosen[2]
                    chosen_degraded = not chosen[2].usable
                    reasons = ['You asked for a lower-cost model, so the cheapest declared model that can '
                        'perform this Shot was chosen.']
        if chosen_degraded:
            # §45: a frame or control the model cannot use is never presented as functional.
            reasons.insert(0, 'This is the closest model you have declared, but it cannot do everything this '
                'Shot needs: ' + ' '.join(best_verdict.reasons))

        fastest = self._pick(ready,
            lambda profile: (1 if profile.speed_note else 0, -(profile.max_duration_ms or 0)), 'fastest')
        cheapest = self._pick(
            [item for item in ready if item[1].cost_known and item[1].cost_amount is not None],
            lambda profile: (-(profile.cost_amount or 0.0),), 'lower cost')
        identity = self._pick(
            [item for item in ready if item[1].identity_note and item[1].supports_image_reference],
            lambda profile: (bool(profile.identity_note),), 'best identity consistency')

        alternatives: list[RoutingChoice] = []
        for kind, candidate in (('FASTEST', fastest), ('LOWER COST', cheapest),
                ('BEST IDENTITY CONSISTENCY', identity)):
            if candidate is None or candidate.model_profile_id == best.model_profile_id:
                continue
            alternatives.append(choice(kind, candidate, self._alternative_reason(kind, candidate, requirements)))
        alternatives.append(self.manual_export_choice(requirements))

        fallback_profile = None
        for _, candidate, _ in ready[1:]:
            if candidate.model_profile_id != best.model_profile_id:
                fallback_profile = candidate
                break
        fallback = choice('FALLBACK', fallback_profile,
            'Declared as capable for this Shot, and a different provider from the recommendation.') \
            if fallback_profile is not None else None

        return RoutingDecision(
            recommended=choice('BEST FIT', best, ' '.join(reasons)),
            fallback=fallback, alternatives=tuple(alternatives), excluded=tuple(excluded),
            reasoning=tuple(reasons), manual_export=self.manual_export_choice(requirements))

    @staticmethod
    def _pick(ready: list[tuple[tuple[int, ...], ModelProfile, CapabilityVerdict]],
        key: Any, _kind: str) -> ModelProfile | None:
        eligible = [(key(profile), profile) for _, profile, _ in ready]
        if not eligible:
            return None
        return max(eligible, key=lambda item: item[0])[1]

    @staticmethod
    def _alternative_reason(kind: str, profile: ModelProfile, requirements: AiRequirements) -> str:
        if kind == 'FASTEST':
            return profile.speed_note or 'Declared as the quicker option for this kind of Shot.'
        if kind == 'LOWER COST':
            currency = profile.cost_currency or ''
            return f'Declared at {profile.cost_amount} {currency} {profile.cost_unit or "per generation"}.'.strip()
        if kind == 'BEST IDENTITY CONSISTENCY':
            return profile.identity_note
        return 'Declared as capable for this Shot.'

    @staticmethod
    def manual_export_choice(requirements: AiRequirements) -> RoutingChoice:
        return RoutingChoice(kind=MANUAL_EXPORT_OPTION, model_profile_id=None, provider_key='manual',
            model_key='manual', label='Manual export',
            reason='No connection needed. TONDE compiles the prompt, references and settings for you to run '
                'yourself, and you record the Attempt it produced.')


@dataclass(frozen=True)
class ShotContext:
    """Everything the compiler may use, gathered from the SAME Master Production."""

    shot: dict[str, Any] = field(default_factory=dict)
    scene: dict[str, Any] = field(default_factory=dict)
    production: dict[str, Any] = field(default_factory=dict)
    brief: dict[str, Any] | None = None
    script_line: dict[str, Any] | None = None
    real_plan: dict[str, Any] | None = None
    locks: list[dict[str, Any]] = field(default_factory=list)
    references: list[dict[str, Any]] = field(default_factory=list)
    techniques: list[dict[str, Any]] = field(default_factory=list)
    continuity_changes: list[dict[str, Any]] = field(default_factory=list)
    product_note: str = ''
    audio_intent: dict[str, Any] | None = None
    declared_negatives: list[str] = field(default_factory=list)
    first_frame: dict[str, Any] = field(default_factory=dict)
    last_frame: dict[str, Any] = field(default_factory=dict)
    previous_shot: dict[str, Any] | None = None
    next_shot: dict[str, Any] | None = None
    temporal_state: str = ''
    framing_relationship: str = ''
    key_props: list[str] = field(default_factory=list)

    @property
    def duration_ms(self) -> int | None:
        value = self.shot.get('planned_duration_ms')
        return int(value) if isinstance(value, int) else None

    def source_versions(self) -> dict[str, Any]:
        """Provenance the prompt carries, so a stale prompt is provable (§24/§25)."""

        return {
            'shot_revision': self.shot.get('revision'),
            'scene_revision': self.scene.get('revision'),
            'production_revision': self.production.get('revision'),
            'locks': {str(lock.get('scope')): lock.get('revision') for lock in self.locks},
            'references': [reference.get('reference_id') or reference.get('asset_id')
                for reference in self.references],
        }


# --- Prompt Compiler (§20-§24, §40, §47). -----------------------------------------

DEFAULT_PROMPT_FORMAT = 'sectioned'
DEFAULT_PROMPT_BUDGET = 3000


def declared_prompt_format(profile: ModelProfile | None, capability_notes: dict[str, Any] | None = None) -> tuple[str, int, str | None]:
    """The provider prompt format, only as far as it was declared.

    TONDE does not claim that a given vendor wants a given syntax. When no format was
    declared for the model, the neutral sectioned format is used and the plan says so.
    """

    # The model's declared notes are the default; a per-plan note may override them.
    notes = {**(profile.capability_notes if profile is not None else {}), **(capability_notes or {})}
    name = str(notes.get('provider_prompt_format') or '').strip()
    budget = notes.get('provider_prompt_max_characters')
    limit = int(budget) if isinstance(budget, int) and 200 <= budget <= 20000 else DEFAULT_PROMPT_BUDGET
    if name in ('sectioned', 'paragraph', 'flat'):
        return name, limit, None
    note = ('No provider prompt format was declared for this model, so TONDE used its neutral '
        'sectioned format.')
    return DEFAULT_PROMPT_FORMAT, limit, note


@dataclass(frozen=True)
class TechniqueApplication:
    """A reference technique applied causally, not by name (§40)."""

    name: str
    directives: tuple[str, ...]


def technique_directives(technique: dict[str, Any]) -> TechniqueApplication:
    """Encode what makes a technique work, rather than pasting its label into a prompt."""

    name = sanitise_untrusted(technique.get('name') or technique.get('technique') or '', limit=120)
    intent = sanitise_untrusted(technique.get('intent') or technique.get('description') or '', limit=200)
    directives: list[str] = []
    lowered = f'{name} {intent}'.lower()
    if 'low' in lowered and 'angle' in lowered:
        directives.append('low camera angle')
    if 'push' in lowered or 'dolly in' in lowered:
        directives.append('progressive push in')
    if 'orbit' in lowered:
        directives.append('clockwise orbit around the subject')
    if 'dominance' in lowered or 'power' in lowered:
        directives.append('subject grows in the frame to feel dominant')
    if 'whip' in lowered:
        directives.append('fast whip into the next Shot')
    if 'handheld' in lowered:
        directives.append('loose handheld drift')
    if 'locked' in lowered or 'static' in lowered:
        directives.append('locked-off camera')
    if intent and not directives:
        directives.append(intent)
    if name and directives and name.lower() not in ' '.join(directives).lower():
        directives.insert(0, f'{name}: realised as')
    return TechniqueApplication(name=name, directives=tuple(dict.fromkeys(directives)))


@dataclass(frozen=True)
class CompiledPrompt:
    sections: dict[str, str]
    canonical_text: str
    provider_prompt: str
    provider_format: str
    negative: tuple[str, ...] = ()
    limitations: tuple[str, ...] = ()
    continuity: dict[str, Any] = field(default_factory=dict)
    first_frame: dict[str, Any] = field(default_factory=dict)
    last_frame: dict[str, Any] = field(default_factory=dict)
    motion: dict[str, Any] = field(default_factory=dict)
    audio: dict[str, Any] = field(default_factory=dict)
    aspect_ratio: str = ''
    duration_ms: int | None = None
    techniques: tuple[TechniqueApplication, ...] = ()
    source_versions: dict[str, Any] = field(default_factory=dict)


class PromptCompiler:
    """Turns production intent into one canonical prompt, then a provider prompt."""

    def compile(self, context: ShotContext, requirements: AiRequirements,
        profile: ModelProfile | None = None, *,
        capability_notes: dict[str, Any] | None = None,
        audio_intent: dict[str, Any] | None = None,
        simplify_motion: bool = False) -> CompiledPrompt:
        shot = context.shot or {}
        scene = context.scene or {}
        brief = context.brief or {}
        locks = context.locks or []
        techniques = tuple(technique_directives(item) for item in (context.techniques or []))
        limitations: list[str] = []

        def character_facts() -> str:
            for lock in locks:
                if lock.get('scope') == 'character' and lock.get('locked'):
                    traits = ', '.join(sanitise_untrusted(trait, limit=60) for trait in
                        (lock.get('locked_traits') or [])) or 'the locked physical traits'
                    return f"{lock.get('label') or 'The Character'}: {traits}. {IDENTITY_TRUTH}"
            return ''

        def world_facts() -> str:
            for lock in locks:
                if lock.get('scope') == 'world' and lock.get('locked'):
                    traits = ', '.join(sanitise_untrusted(trait, limit=60) for trait in (lock.get('locked_traits') or []))
                    return f"{lock.get('label') or 'The World'}: {traits}." if traits else ''
            return sanitise_untrusted(scene.get('description'), limit=200)

        def product_facts() -> str:
            for lock in locks:
                if lock.get('scope') == 'product' and lock.get('locked'):
                    traits = ', '.join(sanitise_untrusted(trait, limit=60) for trait in (lock.get('locked_traits') or []))
                    fidelity = sanitise_untrusted(lock.get('note'), limit=160)
                    return ' '.join(part for part in [
                        f"{lock.get('label') or 'The Product'} stays exactly as supplied; {traits}." if traits else '',
                        fidelity] if part)
            return sanitise_untrusted(context.product_note, limit=200)

        # Character identity reaches the prompt as relevant facts, with the truthful identity
        # promise attached. The rest of the Character record stays out of every Shot (§31).
        subject_facts = ' '.join(part for part in [
            sanitise_untrusted(shot.get('subject') or shot.get('title'), limit=200), character_facts()] if part)

        sections: dict[str, str] = {
            'SUBJECT': subject_facts,
            'ACTION': sanitise_untrusted(shot.get('action') or shot.get('description'), limit=300),
            'ENVIRONMENT': ' '.join(part for part in [sanitise_untrusted(scene.get('title'), limit=120),
                world_facts()] if part),
            'COMPOSITION': sanitise_untrusted(shot.get('composition') or shot.get('framing'), limit=200),
            'CAMERA': ' '.join(part for part in [sanitise_untrusted(shot.get('angle'), limit=80),
                sanitise_untrusted(shot.get('framing'), limit=120)] if part),
            'MOVEMENT': sanitise_untrusted(shot.get('movement'), limit=160),
            'LIGHTING': sanitise_untrusted(brief.get('style_direction') if isinstance(brief.get('style_direction'), str)
                else ', '.join(brief.get('style_direction') or []), limit=240),
            'COLOR / STYLE': self._style_section(locks, brief),
            'PERFORMANCE': sanitise_untrusted(shot.get('story_relationship') or shot.get('purpose'), limit=200),
            'PRODUCT': product_facts(),
            'CONTINUITY': self._continuity_section(context, locks),
            'TIMING': self._timing_section(context),
            'AUDIO': self._audio_section(audio_intent or context.audio_intent),
            'NEGATIVE / AVOID': '',
            'REFERENCES': self._reference_section(context.references),
        }
        if techniques:
            realised = '; '.join(', '.join(item.directives) for item in techniques if item.directives)
            if realised:
                sections['MOVEMENT'] = ' '.join(part for part in [sections['MOVEMENT'], realised] if part)

        negative = self._negative_constraints(context)
        sections['NEGATIVE / AVOID'] = ', '.join(negative)
        sections = {key: value for key, value in sections.items() if value}

        if not sections.get('SUBJECT'):
            limitations.append('This Shot has no subject recorded, so the prompt describes the Scene only.')
        if profile is not None and not profile.supports_image_reference and context.references:
            limitations.append('This model does not accept image references, so identity is carried in words only.')
        if profile is not None and context.references and profile.max_reference_images is not None \
                and len(context.references) > profile.max_reference_images:
            limitations.append(f'Only {profile.max_reference_images} reference image(s) can be sent; the rest are '
                'recorded on the plan for a model that accepts more.')

        first_frame, last_frame = self._frames(context)
        motion = self._motion(shot, requirements, simplify=simplify_motion)
        audio = self._audio(audio_intent or context.audio_intent)
        continuity = self._continuity_packet(context, locks)

        format_name, budget, format_note = declared_prompt_format(profile, capability_notes)
        if format_note:
            limitations.append(format_note)

        return CompiledPrompt(
            sections=sections, canonical_text=self._canonical_text(sections),
            provider_prompt=self._provider_prompt(sections, format_name, budget),
            provider_format=format_name, negative=negative, limitations=tuple(limitations),
            continuity=continuity, first_frame=first_frame, last_frame=last_frame, motion=motion,
            audio=audio, aspect_ratio=str(brief.get('aspect_ratio') or ''), duration_ms=context.duration_ms,
            techniques=techniques, source_versions=context.source_versions())

    @staticmethod
    def _canonical_text(sections: dict[str, str]) -> str:
        return '\n'.join(f'{name}: {sections[name]}' for name in PROMPT_SECTION_ORDER if name in sections)

    @staticmethod
    def _provider_prompt(sections: dict[str, str], format_name: str, budget: int) -> str:
        """The provider prompt is a translation, never the canonical record.

        When a target has a tight budget, optional sections are dropped in a fixed order
        rather than truncating a sentence in half.
        """

        def render(names: list[str]) -> str:
            if format_name == 'flat':
                return ', '.join(sections[name] for name in names)
            if format_name == 'paragraph':
                return ' '.join(sections[name] for name in names)
            return '\n'.join(f'{name}: {sections[name]}' for name in names)

        names = [name for name in PROMPT_SECTION_ORDER if name in sections]
        text = render(names)
        for droppable in DROPPABLE_SECTIONS:
            if len(text) <= budget:
                break
            if droppable in names:
                names = [name for name in names if name != droppable]
                text = render(names)
        if len(text) <= budget:
            return text
        # Last resort: the declared budget is still respected, cut on a word boundary.
        head, _, _ = text[:budget].rpartition(' ')
        return head or text[:budget]

    @staticmethod
    def _style_section(locks: list[dict[str, Any]], brief: dict[str, Any]) -> str:
        for lock in locks:
            if lock.get('scope') == 'style' and lock.get('locked'):
                traits = lock.get('locked_traits') or []
                if traits:
                    return ', '.join(sanitise_untrusted(trait, limit=60) for trait in traits)
        direction = brief.get('style_direction')
        if isinstance(direction, list):
            return ', '.join(sanitise_untrusted(item, limit=60) for item in direction)
        return sanitise_untrusted(direction, limit=240)

    @staticmethod
    def _continuity_section(context: ShotContext, locks: list[dict[str, Any]]) -> str:
        parts: list[str] = []
        if context.previous_shot:
            parts.append(f"Continues from Shot '{sanitise_untrusted(context.previous_shot.get('title'), limit=80)}'.")
        if context.next_shot:
            parts.append(f"Must hand off to Shot '{sanitise_untrusted(context.next_shot.get('title'), limit=80)}'.")
        if context.script_line:
            line = sanitise_untrusted(context.script_line.get('content'), limit=200)
            if line:
                parts.append(f'Spoken line: {line}')
        for lock in locks:
            if lock.get('locked') and lock.get('scope') in ('character', 'world', 'product'):
                variations = lock.get('allowed_variations') or []
                if variations:
                    parts.append(f"Within {lock.get('scope')}, only these may vary: "
                        + ', '.join(sanitise_untrusted(item, limit=40) for item in variations) + '.')
        return ' '.join(parts)

    @staticmethod
    def _timing_section(context: ShotContext) -> str:
        duration = context.duration_ms
        if not duration:
            return ''
        seconds = duration / 1000
        return f'{duration} ms ({seconds:g}s) of finished runtime.'

    @staticmethod
    def _audio_section(intent: dict[str, Any] | None) -> str:
        if not intent:
            return ''
        parts = []
        for key in AUDIO_MODALITIES:
            entry = intent.get(key)
            if isinstance(entry, dict) and entry.get('needed'):
                parts.append(f"{key.replace('_', ' ')}: {sanitise_untrusted(entry.get('direction'), limit=200)}")
        return '; '.join(part for part in parts if part and not part.endswith(': '))

    @staticmethod
    def _reference_section(references: list[dict[str, Any]] | None) -> str:
        if not references:
            return ''
        parts = []
        for reference in references:
            role = str(reference.get('role') or '')
            # Reference notes are untrusted data: sanitised, and labelled as reference data.
            note = sanitise_untrusted(reference.get('note'), limit=120)
            label = f'{role} reference' + (f' ({note})' if note else '')
            parts.append(label)
        return '; '.join(parts)

    @staticmethod
    def _negative_constraints(context: ShotContext) -> tuple[str, ...]:
        negatives: list[str] = ['no invented brand marks', 'do not alter locked identity traits']
        for lock in context.locks or []:
            for prohibited in lock.get('prohibited_changes') or []:
                clean = sanitise_untrusted(prohibited, limit=80)
                if clean:
                    negatives.append(f'no change to {clean}')
        for item in context.declared_negatives or []:
            clean = sanitise_untrusted(item, limit=120)
            if clean:
                negatives.append(clean)
        return tuple(dict.fromkeys(negatives))[:16]

    @staticmethod
    def _frames(context: ShotContext) -> tuple[dict[str, Any], dict[str, Any]]:
        return (dict(context.first_frame or {}), dict(context.last_frame or {}))

    @staticmethod
    def _motion(shot: dict[str, Any], requirements: AiRequirements, *, simplify: bool = False) -> dict[str, Any]:
        movement = sanitise_untrusted(shot.get('movement'), limit=160)
        if not movement:
            return {'needed': False, 'description': '', 'intensity': 'none'}
        complex_motion = any(token in movement.lower() for token in ('orbit', 'crane', 'whip', 'handheld'))
        note = ('This movement is complex for one generation; TONDE will propose a split or a '
            'simpler move rather than forcing it.') if complex_motion else ''
        if complex_motion and simplify:
            note = ('You asked to make this easier to generate, so the move is compressed to one camera '
                'movement with no competing subject motion.')
            return {'needed': True, 'description': movement, 'intensity': 'medium', 'camera_only': True,
                'simplified': True, 'simplification': note}
        return {'needed': True, 'description': movement,
            'intensity': 'high' if complex_motion else 'low',
            'camera_only': True, 'simplified': False,
            'simplification': note}

    @staticmethod
    def _audio(intent: dict[str, Any] | None) -> dict[str, Any]:
        if not intent:
            return {'needed': False}
        return {'needed': _audio_needed(intent), **intent}

    @staticmethod
    def _continuity_packet(context: ShotContext, locks: list[dict[str, Any]]) -> dict[str, Any]:
        """Only the relevant continuity, never the whole Production (§72)."""

        must: list[str] = []
        should: list[str] = []
        flexible: list[str] = []
        for lock in locks:
            if not lock.get('locked'):
                continue
            entry = str(lock.get('scope'))
            priority = lock.get('priority') or 'MUST PRESERVE'
            if priority == 'MUST PRESERVE':
                must.append(entry)
            elif priority == 'SHOULD PRESERVE':
                should.append(entry)
            else:
                flexible.append(entry)
        return {
            'must': list(dict.fromkeys(must)), 'should': list(dict.fromkeys(should)),
            'flexible': list(dict.fromkeys(flexible)),
            'previous_state': (context.previous_shot or {}).get('ending_state') or '',
            'next_state': (context.next_shot or {}).get('opening_state') or '',
            'temporal_state': context.temporal_state,
            'framing_relationship': context.framing_relationship,
            'key_props': [sanitise_untrusted(item, limit=60) for item in context.key_props],
            'changes': [change for change in (context.continuity_changes or [])],
        }


def build_requirements(context: ShotContext, profile: ModelProfile | None = None,
    *, operation: str | None = None, product_importance: FidelityImportance = 'flexible',
    identity_importance: FidelityImportance = 'flexible') -> AiRequirements:
    """Derive what the Shot requires from production context, not from a wish."""

    references = context.references or []
    must = [item for item in references if (item.get('priority') or 'SHOULD PRESERVE') == 'MUST PRESERVE']
    first = context.first_frame or {}
    last = context.last_frame or {}
    motion_needed = bool((context.shot or {}).get('movement'))
    locks = context.locks or []
    # A locked Character or Product is a fidelity requirement, not a preference. The creator can
    # still say otherwise, but TONDE does not treat an explicit lock as optional.
    if product_importance == 'flexible' and any(lock.get('scope') == 'product' and lock.get('locked')
            for lock in locks):
        product_importance = 'critical'
    if identity_importance == 'flexible' and any(lock.get('scope') == 'character' and lock.get('locked')
            for lock in locks):
        identity_importance = 'critical'
    prohibited = sum(len(lock.get('prohibited_changes') or []) for lock in locks if lock.get('locked'))
    negative_count = len(context.declared_negatives or []) + len(context.continuity_changes or []) + prohibited
    brief = context.brief or {}
    return AiRequirements(
        operation=operation or ('image_to_video' if motion_needed else 'video'),
        reference_count=len(references), must_reference_count=len(must),
        needs_first_frame=bool(str(first.get('source') or '').strip()),
        needs_last_frame=bool(str(last.get('source') or '').strip()),
        needs_audio=_audio_needed(context.audio_intent),
        needs_camera_control=motion_needed, needs_negative_prompt=negative_count > 0,
        duration_ms=context.duration_ms, aspect_ratio=str(brief.get('aspect_ratio') or ''),
        identity_importance=identity_importance, product_importance=product_importance,
        motion_complexity='complex' if any(token in str((context.shot or {}).get('movement') or '').lower()
            for token in ('orbit', 'crane', 'whip', 'handheld', 'arc')) else 'simple',
        negative_constraint_count=negative_count)


# --- Hybrid Director (§75-§82). ---------------------------------------------------

SHOOT = 'shoot'
GENERATE = 'generate'
SHOOT_AI = 'hybrid'


@dataclass(frozen=True)
class DirectionIntent:
    """A creator's AI direction, interpreted deterministically (§71).

    Every field is a change TONDE can actually make to a plan it already compiles. Nothing
    here invents capability: 'use a lower-cost model' can only choose among declared models,
    and 'switch to image-to-video' is refused where the operation is not declared.
    """

    applied: tuple[str, ...] = ()
    simplify_motion: bool = False
    only_connected: bool = False
    prefer_lower_cost: bool = False
    identity_critical: bool = False
    product_visible: bool = False
    same_world: bool = False
    operation: str | None = None
    note: str = ''


DIRECTION_OPERATIONS: dict[str, str] = {
    'image-to-video': 'image_to_video', 'image to video': 'image_to_video',
    'text-to-video': 'video', 'text to video': 'video',
    'first frame': 'image', 'generate a first frame': 'image',
    'upscal': 'upscale', 'lipsync': 'lipsync', 'lipsync the': 'lipsync',
    'background removal': 'background_removal', 'image edit': 'image_edit',
}


def interpret_direction(text: Any) -> DirectionIntent:
    """Read the creator's words into the changes TONDE will make, and say which it honoured."""

    lowered = sanitise_untrusted(text, limit=600).lower()
    if not lowered:
        return DirectionIntent()
    applied: list[str] = []
    intent = {'simplify_motion': False, 'only_connected': False, 'prefer_lower_cost': False,
        'identity_critical': False, 'product_visible': False, 'same_world': False}

    if any(token in lowered for token in ('simpler', 'simple', 'easier to generate', 'make this shot easier')):
        intent['simplify_motion'] = True
        applied.append('motion simplified')
    if 'only' in lowered and 'connect' in lowered:
        intent['only_connected'] = True
        applied.append('only models you have connected')
    if 'lower-cost' in lowered or 'lower cost' in lowered or 'cheaper' in lowered:
        intent['prefer_lower_cost'] = True
        applied.append('lower-cost model preferred')
    if 'character' in lowered and any(token in lowered for token in ('exactly', 'keep', 'same', 'consistent')):
        intent['identity_critical'] = True
        applied.append('identity treated as critical')
    if 'product' in lowered and ('more visible' in lowered or 'visibility' in lowered):
        intent['product_visible'] = True
        applied.append('Product fidelity treated as critical')
    if 'world' in lowered and ('same' in lowered or 'keep' in lowered):
        intent['same_world'] = True
        applied.append('World continuity kept')

    operation = None
    for phrase, value in DIRECTION_OPERATIONS.items():
        if phrase in lowered:
            operation = value
            applied.append(f'operation retargeted to {value.replace("_", " ")}')
            break

    note = ('' if applied else 'That direction did not map to a change TONDE can make to this plan, so the '
        'plan was compiled from the Shot as it stands.')
    return DirectionIntent(applied=tuple(applied), operation=operation, note=note, **intent)


AUDIO_MODALITIES: tuple[str, ...] = ('narration', 'music', 'ambience', 'sound_effect')


def _audio_needed(intent: dict[str, Any] | None) -> bool:
    """Audio intent is stored per modality, so 'needed' is read the same way everywhere."""

    if not intent:
        return False
    return any(isinstance(intent.get(key), dict) and bool(intent[key].get('needed'))
        for key in AUDIO_MODALITIES)


def _owned_setup(setup: dict[str, Any] | None) -> tuple[set[str], set[str]]:
    inventory = setup or {}
    resources = inventory.get('resources') or inventory.get('setup') or []
    owned = {str(item.get('resource_type') or '') for item in resources}
    missing = {str(item) for item in (inventory.get('missing') or [])}
    return owned, missing


@dataclass(frozen=True)
class HybridDecision:
    """A recommendation, with the practical and generated parts named separately."""

    method: str
    reasons: tuple[str, ...] = ()
    shoot_component: str = ''
    generate_component: str = ''
    combine: tuple[str, ...] = ()
    matching: tuple[str, ...] = ()
    limitations: tuple[str, ...] = ()
    plate_requirements: tuple[str, ...] = ()
    factors: dict[str, Any] = field(default_factory=dict)
    advisory: bool = True


class HybridAdvisor:
    """Decides SHOOT / GENERATE / SHOOT + AI from feasibility, fidelity and setup.

    Advisory by construction: the creator is authoritative, and an override is stored
    rather than argued with (§77/§143).
    """

    def advise(self, context: ShotContext, requirements: AiRequirements, routing: RoutingDecision,
        *, setup: dict[str, Any] | None = None, environment_achievable: bool | None = None,
        product_reflective: bool = False, creator_choice: str | None = None) -> HybridDecision:
        owned, missing = _owned_setup(setup)
        practical_ready = {'camera', 'light'} <= owned if owned else False
        practical_blocked = bool(missing)
        ai_possible = routing.recommended is not None
        manual_possible = routing.manual_export is not None
        reasons: list[str] = []
        factors: dict[str, Any] = {
            'practical_setup_owned': sorted(owned), 'practical_missing': sorted(missing),
            'practical_ready': practical_ready, 'ai_model_available': ai_possible,
            'manual_export_available': manual_possible,
            'product_importance': requirements.product_importance,
            'identity_importance': requirements.identity_importance,
            'motion_complexity': requirements.motion_complexity,
            'compatible_models': routing.recommended.model_key if routing.recommended else None,
        }
        # A creator override is authoritative and is never silently replaced.
        if creator_choice in (SHOOT, GENERATE, SHOOT_AI):
            factors['creator_override'] = creator_choice
            decision = self._describe(creator_choice, context, requirements, product_reflective)
            return HybridDecision(method=creator_choice,
                reasons=('You chose this execution method, so TONDE keeps it.',) + decision.reasons,
                shoot_component=decision.shoot_component, generate_component=decision.generate_component,
                combine=decision.combine, matching=decision.matching, limitations=decision.limitations,
                plate_requirements=decision.plate_requirements, factors=factors)

        # 1. Exact Product fidelity that a model cannot be trusted to reproduce is the
        #    clearest Hybrid case: shoot the Product, generate around it (§38/§140).
        if requirements.product_importance == 'critical' and (product_reflective or not ai_possible \
                or not (routing.recommended and routing.recommended.model_profile_id)):
            reasons.append('This Product must stay exact, and a generated version of a reflective branded '
                'package cannot be trusted to match it.')
            reasons.append('Shooting the Product practically and generating the World around it keeps the '
                'packaging truthful and the Scene achievable.')
            decision = self._describe(SHOOT_AI, context, requirements, product_reflective)
            return HybridDecision(method=SHOOT_AI, reasons=tuple(reasons), shoot_component=decision.shoot_component,
                generate_component=decision.generate_component, combine=decision.combine,
                matching=decision.matching, limitations=decision.limitations,
                plate_requirements=decision.plate_requirements, factors=factors)

        # 2. A Shot the creator can really shoot is shot. AI is not used because it exists.
        if practical_ready and not practical_blocked and environment_achievable is not False \
                and requirements.motion_complexity == 'simple':
            reasons.append('Your Setup covers this Shot as written and the movement is simple, so capturing it '
                'is more reliable than generating it.')
            if requirements.identity_importance == 'critical':
                reasons.append('A captured performance carries identity exactly, which no generation can promise.')
            return HybridDecision(method=SHOOT, reasons=tuple(reasons),
                shoot_component=self._shoot_component(context, requirements),
                limitations=('Capture depends on your Setup being available on the day.',), factors=factors)

        # 3. An Environment that cannot be reached practically is generated.
        if environment_achievable is False and ai_possible:
            reasons.append('This Environment cannot be reached practically with what you have, and a declared '
                'model can build it.')
            decision = self._describe(GENERATE, context, requirements, product_reflective)
            return HybridDecision(method=GENERATE, reasons=tuple(reasons), shoot_component=decision.shoot_component,
                generate_component=decision.generate_component, combine=decision.combine,
                matching=decision.matching, limitations=decision.limitations,
                plate_requirements=decision.plate_requirements, factors=factors)

        # 4. Otherwise the practical elements are captured and the rest is generated.
        if ai_possible and (practical_ready or not practical_blocked):
            reasons.append('Part of this Shot is practical and part of it is not, so TONDE names both components '
                'rather than choosing one.')
            decision = self._describe(SHOOT_AI, context, requirements, product_reflective)
            return HybridDecision(method=SHOOT_AI, reasons=tuple(reasons), shoot_component=decision.shoot_component,
                generate_component=decision.generate_component, combine=decision.combine,
                matching=decision.matching, limitations=decision.limitations,
                plate_requirements=decision.plate_requirements, factors=factors)

        # 5. Nothing is available yet: say so, and keep the manual path open.
        reasons.append('No declared model can perform this Shot and your Setup does not cover it, so TONDE '
            'recommends capturing what you can and exporting the rest.')
        decision = self._describe(SHOOT_AI, context, requirements, product_reflective)
        return HybridDecision(method=SHOOT_AI, reasons=tuple(reasons), shoot_component=decision.shoot_component,
            generate_component=decision.generate_component, combine=decision.combine, matching=decision.matching,
            limitations=tuple(decision.limitations) + ('Nothing can be generated until a model is declared.',),
            plate_requirements=decision.plate_requirements, factors=factors)

    def _describe(self, method: str, context: ShotContext, requirements: AiRequirements,
        product_reflective: bool) -> HybridDecision:
        if method == SHOOT:
            return HybridDecision(method=SHOOT, shoot_component=self._shoot_component(context, requirements),
                limitations=('All of this Shot is captured; no generation is planned.',))
        if method == GENERATE:
            return HybridDecision(method=GENERATE,
                generate_component=self._generate_component(context, requirements),
                limitations=('Generated output is a proposal. Identity, Product and World are preserved only as '
                    'closely as the selected model supports.',))
        return HybridDecision(method=SHOOT_AI,
            shoot_component=self._shoot_component(context, requirements),
            generate_component=self._generate_component(context, requirements),
            combine=('Match the practical light direction when compiling the prompt.',
                'Keep the camera height and lens character of the plate.'),
            matching=('Shadow direction on the counter', 'Colour temperature of the practical light',
                'Camera height and lens character'),
            limitations=('Compositing quality depends on the plate you capture, and TONDE does not claim '
                'production-grade compositing for you.',),
            plate_requirements=('Locked camera', 'Clean plate', 'Consistent lighting across takes',
                'Extra headroom for the generated element',
                'Tracking markers only where genuinely needed'))

    @staticmethod
    def _shoot_component(context: ShotContext, requirements: AiRequirements) -> str:
        shot = context.shot or {}
        if requirements.product_importance == 'critical':
            return f"Shoot the Product for '{shot.get('title') or 'this Shot'}' so its packaging stays exact."
        return f"Shoot '{shot.get('title') or 'this Shot'}' as planned, with the Setup you own."

    @staticmethod
    def _generate_component(context: ShotContext, requirements: AiRequirements) -> str:
        scene = context.scene or {}
        return f"Generate {scene.get('title') or 'the Environment'} and the elements that cannot be captured."


# --- Repository: the guarded RPCs, nothing else. ----------------------------------

LAYER = 'AI creation'


class AiCreationRepository:
    """Reads and writes the AI Creation layer through the guarded RPCs.

    Every capability, lock, staleness and idempotency rule is enforced in the database,
    so this class cannot accidentally bypass one.
    """

    def __init__(self, gateway: Any) -> None:
        self.gateway = gateway

    async def surface(self, workspace_id: UUID, production_id: UUID, token: str, *,
        expected_revision: int | None = None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('ai_creation_surface', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'expected_production_revision': expected_revision})

    async def detail(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('ai_shot_detail', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id)})

    async def catalog(self, workspace_id: UUID, token: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('ai_model_catalog', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id)})

    async def verdict(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, profile_id: UUID,
        token: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('ai_capability_verdict', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'target_profile': str(profile_id)})

    async def declare_model(self, workspace_id: UUID, token: str, payload: dict[str, Any],
        expected_revision: int | None = None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('declare_ai_model', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'payload': payload,
            'expected_revision': expected_revision})

    async def set_connection(self, workspace_id: UUID, token: str, provider_key: str, state: str,
        credential_reference: str, note: str, expected_revision: int | None = None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('set_ai_connection', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_provider': provider_key, 'target_state': state,
            'credential_reference': credential_reference, 'note': note, 'expected_revision': expected_revision})

    async def save_plan(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str, *,
        plan: dict[str, Any], references: list[dict[str, Any]], expected_shot_revision: int | None = None,
        expected_plan_revision: int | None = None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('save_ai_plan', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'expected_shot_revision': expected_shot_revision,
            'plan': plan, 'references_json': references,
            'expected_plan_revision': expected_plan_revision})

    async def set_plan_approval(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str,
        approval: str, expected_revision: int | None = None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('set_ai_plan_approval', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'target_approval': approval, 'expected_revision': expected_revision})

    async def set_plan_lock(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str,
        locked: bool, expected_revision: int | None = None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('set_ai_plan_lock', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'target_locked': locked, 'expected_revision': expected_revision})

    async def confirm_cost(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str,
        note: str = '') -> dict[str, Any]:
        return await self.gateway.rpc_detailed('confirm_ai_cost', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'note': note})

    async def set_lock(self, workspace_id: UUID, production_id: UUID, token: str, payload: dict[str, Any],
        expected_revision: int | None = None) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('set_ai_lock', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'payload': payload, 'expected_revision': expected_revision})

    async def create_attempt(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str,
        payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('create_ai_attempt', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'payload': payload})

    async def update_attempt(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, attempt_id: UUID,
        token: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('update_ai_attempt', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'target_attempt': str(attempt_id), 'payload': payload})

    async def select_result(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, attempt_id: UUID,
        token: str) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('select_ai_result', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'target_attempt': str(attempt_id)})

    async def batch_preview(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str,
        payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('ai_batch_preview', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'payload': payload})

    async def create_batch(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str,
        payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('create_ai_batch', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'payload': payload})

    async def switch_execution_method(self, workspace_id: UUID, production_id: UUID, shot_id: UUID, token: str,
        *, method: str, expected_revision: int | None) -> dict[str, Any]:
        """Execution method is a property of the canonical Shot, so it goes through the Studio guard.

        Hybrid and AI switching therefore never forks the Shot: the same identifier simply
        carries a different execution method.
        """

        return await self.gateway.rpc_detailed('update_studio_shot', token=token, layer='Studio workspace', json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_shot': str(shot_id), 'expected_revision': expected_revision,
            'patch': {'execution_method': method}})

    async def record_batch_item(self, workspace_id: UUID, production_id: UUID, batch_id: UUID, shot_id: UUID,
        token: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self.gateway.rpc_detailed('record_ai_batch_item', token=token, layer=LAYER, json={
            'target_workspace': str(workspace_id), 'target_production': str(production_id),
            'target_batch': str(batch_id), 'target_shot': str(shot_id), 'payload': payload})


