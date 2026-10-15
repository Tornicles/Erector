"""Adaptive creative-intake decision engine (server-side).

The intake flow is a decision engine, not a questionnaire::

    INPUT -> UNDERSTANDING -> GAP ANALYSIS -> MATERIALITY RANKING
      -> QUESTION GENERATION -> STOP WHEN ENOUGH

Only a missing decision that would materially change the downstream
Production becomes a visible decision card. Everything else is classified
as KNOWN (stated or established), INFERRED (usable unless consequential)
or DEFERRED (wardrobe, lenses, exact lighting: real decisions, but not
intake decisions).

Determinism and honesty: this module ranks known decision contracts. Semantic
interpretation and TONDE DECIDE recommendations are supplied by the configured
Director; this module never presents a deterministic heuristic as model work.
It never invents facts, never exposes numeric materiality scores, and never
asks a question merely because a database field is null.

Stability contract: decision ids reuse the legacy brief-decision ids
(``product``, ``platform``, ``runtime``, ``dialogue_mode``, ``premise``,
``series_horizon``, ``cta``, ``audience``, ``tone``) wherever the meaning is
identical, so one answer settles both the intake queue and the brief's open
decisions.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from app.domain import director as director_domain
from app.domain.director import DirectorModel, ProductionIntent
from app.domain.vocabulary import ProductionType

FactSource = Literal[
    'user_said', 'reference_shows', 'script_establishes',
    'tonde_inferred', 'tonde_recommended', 'user_confirmed',
]

AnswerMode = Literal['single_select', 'multi_select', 'freeform', 'yes_no', 'duration']

#: Hard product cap: never more than five open decisions, normally 1-3.
MAX_OPEN_DECISIONS = 5

#: Real decisions that must never appear during creative intake.
DEFERRED_TOPICS = (
    'Exact wardrobe',
    'Specific lens choice',
    'Final music selection',
    'Precise lighting package',
    'Exact prop list',
)


class IntakeFact(DirectorModel):
    """One settled piece of Production understanding with provenance."""

    key: str
    label: str
    value: str = ''
    confidence: Literal['high', 'medium', 'low'] = 'medium'
    source: FactSource = 'user_said'
    evidence: list[str] = []
    confirmed: bool = False


class DecisionOption(DirectorModel):
    id: str
    label: str
    description: str = ''


class DecisionRecommendation(DirectorModel):
    option_ids: list[str] = []
    reason: str = ''


class MaterialDecision(DirectorModel):
    """One decision that genuinely changes the Production, ranked internally."""

    decision_id: str
    topic: str
    question: str
    why: str
    answer_mode: AnswerMode = 'single_select'
    options: list[DecisionOption] = []
    recommendation: DecisionRecommendation = DecisionRecommendation()
    rank: int = 50
    state: Literal['open', 'answered', 'tonde_decided'] = 'open'
    impact: Literal['critical', 'high', 'medium'] = 'high'
    answer: str | None = None
    answered_by: Literal['creator', 'tonde', 'extracted'] | None = None


class IntakeAnalysis(DirectorModel):
    production_family: str = 'general'
    known: list[IntakeFact] = []
    inferred: list[IntakeFact] = []
    deferred: list[str] = []
    material_unknowns: list[MaterialDecision] = []
    #: Every evaluated decision with its live state (open, answered, tonde_decided).
    decisions: list[MaterialDecision] = []
    enough_to_direct: bool = False
    blocking_open: int = 0
    creative_direction_summary: str = ''
    creative_facts: list[str] = []
    producer: Literal['deterministic', 'model'] = 'deterministic'


# ---------------------------------------------------------------------------
# Production families: decision behavior, not database values.
# ---------------------------------------------------------------------------

def classify_family(intent: ProductionIntent, goal: str, answered: dict[str, str]) -> str:
    """Decide which decision catalog applies. The DB production type stays
    authoritative for persistence; the family only shapes intake questions."""
    kind = intent.primary_type
    text = f'{goal} {answered.get("deliverable", "")} {answered.get("output", "")}'.lower()
    if kind in {ProductionType.commercial, ProductionType.advertisement, ProductionType.product_film}:
        return 'commercial'
    if kind == ProductionType.documentary:
        return 'documentary'
    if kind == ProductionType.interview:
        return 'interview'
    if kind == ProductionType.music_video:
        return 'music_video'
    if kind in {ProductionType.photography, ProductionType.portrait, ProductionType.product_photography,
                ProductionType.fashion, ProductionType.food, ProductionType.automotive,
                ProductionType.architecture, ProductionType.poster, ProductionType.thumbnail}:
        return 'photography'
    if kind == ProductionType.series:
        return 'narrative'
    if kind == ProductionType.recurring_content:
        return 'series'
    if kind == ProductionType.social_video:
        return 'social'
    if kind == ProductionType.youtube:
        return 'social'
    if any(word in text for word in ('wedding', 'bride', 'groom', 'ceremony', 'reception')):
        return 'wedding'
    if kind == ProductionType.custom and ('series' in text or 'episode' in text):
        return 'narrative'
    if kind == ProductionType.custom and any(word in text for word in ('story', 'zombie', 'horror', 'mystery', 'film about', 'movie about', 'script')):
        return 'narrative'
    if any(word in text for word in ('soccer', 'football match', 'basketball', 'game highlights', 'tournament', 'match day',
                                     'soccer game', 'football game', 'basketball game', 'sports day', 'athlete', 'sport ')):
        return 'sports'
    if any(word in text for word in ('conference', 'keynote', 'summit', 'workshop event', 'corporate event', 'gala', 'festival coverage')):
        return 'event'
    if kind in {ProductionType.short_film, ProductionType.long_form_film, ProductionType.trailer, ProductionType.campaign}:
        return 'narrative'
    if any(word in text for word in ('story', 'episode', 'series', 'film about', 'movie about', 'horror', 'mystery', 'zombie', 'script')):
        return 'narrative'
    return 'general'


# ---------------------------------------------------------------------------
# Fact building: everything the intent already settles, with provenance.
# ---------------------------------------------------------------------------

def extract_setting(goal: str) -> str | None:
    """A capitalized place named after in/set in/around. Conservative: only
    proper nouns, never common nouns, so vagueness asks instead of guessing."""
    match = re.search(r'\b(?:set\s+in|filmed\s+in|shot\s+in|in|around|across)\s+([A-Z][\w\'.\-]+(?:\s+[A-Z][\w\'.\-]+){0,2})', goal)
    if not match:
        return None
    place = match.group(1).strip(' .,:;')
    if place.lower() in {'the city', 'the country', 'town', 'here', 'there'}:
        return None
    return place


def _fact(key: str, label: str, value: str, source: FactSource, confidence: str = 'high',
          evidence: list[str] | None = None, confirmed: bool = False) -> IntakeFact:
    return IntakeFact(key=key, label=label, value=value,
                      confidence=confidence,  # type: ignore[arg-type]
                      source=source, evidence=evidence or [], confirmed=confirmed)


def build_known_facts(intent: ProductionIntent, goal: str,
                      evidence_labels: list[str]) -> list[IntakeFact]:
    facts: list[IntakeFact] = []
    if intent.subject:
        facts.append(_fact('subject', 'Subject', intent.subject, 'user_said',
                           evidence=['named in the intake goal or a confirmed answer'], confirmed=True))
    setting = extract_setting(goal)
    if setting:
        facts.append(_fact('setting', 'Setting', setting, 'user_said',
                           evidence=['named in the intake goal'], confirmed=True))
    if intent.platform:
        facts.append(_fact('platform', 'Platform', intent.platform, 'user_said', confirmed=True))
    if intent.runtime_ms is not None:
        facts.append(_fact('runtime', 'Runtime', _format_ms(intent.runtime_ms), 'user_said', confirmed=True))
    if intent.aspect_ratio:
        facts.append(_fact('aspect_ratio', 'Format', intent.aspect_ratio, 'user_said'))
    if intent.execution is not None:
        facts.append(_fact('execution', 'Execution', str(intent.execution.value).replace('_', ' '), 'user_said'))
    if intent.dialogue_mode:
        facts.append(_fact('dialogue', 'Dialogue', str(intent.dialogue_mode).replace('_', ' '), 'user_said'))
    for constraint in intent.constraints.hard_constraints:
        facts.append(_fact('constraint', 'Constraint', constraint, 'user_said'))
    for deliverable in intent.deliverables:
        facts.append(_fact('deliverable', 'Deliverable', deliverable, 'user_said', confirmed=True))
    for label in evidence_labels[:6]:
        facts.append(_fact('source', 'Attached source', label, 'user_said',
                           evidence=['linked to this intake; analysis state reported separately']))
    return facts


def _format_ms(value: int) -> str:
    seconds = round(value / 1000)
    if seconds < 60:
        return f'~{seconds} seconds'
    minutes = seconds / 60
    if minutes < 60:
        return f'~{minutes:g} minutes'
    return f'~{minutes / 60:g} hours'


def build_inferred_facts(intent: ProductionIntent, goal: str, family: str,
                         reference_mechanics: list[str], story_material: bool) -> list[IntakeFact]:
    lower = goal.lower()
    inferred: list[IntakeFact] = []
    if family == 'narrative' and any(word in lower for word in ('disappear', 'mystery', 'vanish', 'secret')):
        inferred.append(_fact('engine_hint', 'Likely story engine', 'mystery / discovery', 'tonde_inferred',
                              confidence='medium', evidence=['goal contains an unanswered-world question']))
    if family == 'narrative' and any(word in lower for word in ('zombie', 'horror', 'survival', 'ghost', 'haunted')):
        inferred.append(_fact('tone_hint', 'Likely tone', 'horror / survival elements', 'tonde_inferred',
                              confidence='medium', evidence=['goal names horror or survival elements']))
    for mechanic in reference_mechanics[:4]:
        inferred.append(_fact('reference_mechanic', 'Reference shows', mechanic, 'reference_shows',
                              confidence='medium', evidence=['attached reference analysis']))
    if story_material:
        inferred.append(_fact('story_material', 'Story material attached', 'structure may already exist — TONDE will not ask for the story', 'tonde_inferred',
                              confidence='medium', evidence=['attached source carries substantial text']))
    return inferred


# ---------------------------------------------------------------------------
# Decision catalogs: per-family unknowns ordered by downstream impact.
# ---------------------------------------------------------------------------

class _Spec:
    def __init__(self, decision_id: str, topic: str, question: str, why: str, rank: int,
                 impact: Literal['critical', 'high', 'medium'], answer_mode: AnswerMode,
                 options: list[tuple[str, str, str]],
                 recommend: list[str], reason: str) -> None:
        self.decision_id = decision_id
        self.topic = topic
        self.question = question
        self.why = why
        self.rank = rank
        self.impact = impact
        self.answer_mode = answer_mode
        self.options = options
        self.recommend = recommend
        self.reason = reason


def _family_specs() -> dict[str, list[_Spec]]:
    return {
        'narrative': [
            _Spec('format', 'Scale', 'How big should this story be?',
                  'A short video, film and series need completely different structures.', 100, 'critical', 'single_select',
                  [('short_video', 'Short video', '30 seconds to 3 minutes, one arc'),
                   ('short_film', 'Short film', '5 to 20 minutes, full story'),
                   ('series', 'Episodic series', 'Multiple parts with reveals'),
                   ('feature', 'Feature', 'Long-form movie')],
                  ['series'], 'A series gives this premise room for progressive reveals without solving the mystery too quickly.'),
            _Spec('direction', 'Creative direction', 'Which direction feels most like what you want?',
                  'One combined direction choice replaces separate genre, tone and mood questions.', 90, 'high', 'single_select',
                  [('dark_mystery', 'Dark mystery', 'Atmosphere and unanswered questions'),
                   ('emotional_survival', 'Emotional survival', 'Character under threat'),
                   ('grounded_horror', 'Grounded horror', 'Believable fear, slow escalation'),
                   ('high_energy_action', 'High-energy action', 'Momentum and physical stakes')],
                  ['dark_mystery'], 'The disappearance premise already gives the story a strong unanswered question, so mystery-first structure fits best.'),
            _Spec('story_engine', 'Story engine', 'What should keep the story moving?',
                  'The engine decides what every scene, card and episode must advance.', 80, 'high', 'single_select',
                  [('what_happened', 'What happened?', 'Mystery and discovery'),
                   ('survive', 'Can she survive?', 'Immediate survival stakes'),
                   ('find_someone', 'Find someone', 'Relationship and search'),
                   ('who_caused', 'Who caused this?', 'Investigation and conspiracy')],
                  ['what_happened'], 'The idea already contains a strong unanswered-world question, so discovery is the cleanest engine.'),
        ],
        'series': [
            _Spec('episode_count', 'Episodes', 'How many episodes should TONDE plan first?',
                  'Episode count sizes the whole production plan.', 100, 'critical', 'single_select',
                  [('short_run', 'Short run', '3 to 6 episodes'), ('season', 'Full season', '8 to 12 episodes'),
                   ('ongoing', 'Ongoing', 'Open-ended cadence')],
                  ['short_run'], 'A short first run proves the format before committing to a full season.'),
            _Spec('direction', 'Creative direction', 'Which direction feels most like what you want?',
                  'Direction shapes every episode, not just the first.', 90, 'high', 'single_select',
                  [('dark_mystery', 'Dark mystery', 'Atmosphere and unanswered questions'),
                   ('emotional_survival', 'Emotional survival', 'Character under threat'),
                   ('grounded_horror', 'Grounded horror', 'Believable fear, slow escalation'),
                   ('high_energy_action', 'High-energy action', 'Momentum and physical stakes')],
                  ['dark_mystery'], 'A consistent direction across episodes matters more than per-episode variety.'),
            _Spec('episode_length', 'Episode length', 'About how long should each episode run?',
                  'Episode length determines scene count per episode.', 80, 'high', 'duration',
                  [('under_2', 'Under 2 minutes', 'Short-form episodes'), ('2_5', '2 to 5 minutes', 'Standard episodes'),
                   ('over_5', 'Over 5 minutes', 'Longer episodes')],
                  ['2_5'], 'Two to five minutes fits a reveal-per-episode structure without overstretching.'),
        ],
        'commercial': [
            _Spec('product', 'Brand', 'Which brand or product is this for?',
                  'The product determines the message, proof and hero moments.', 100, 'critical', 'freeform', [],
                  [], ''),
            _Spec('objective', 'Objective', 'What must this commercial accomplish?',
                  'The objective decides the hook, the proof and the call to action.', 95, 'critical', 'single_select',
                  [('sell', 'Sell product', 'Drive purchase'), ('launch', 'Launch product', 'Create excitement'),
                   ('explain', 'Explain product', 'Make the value clear'), ('brand', 'Build brand', 'Create recognition')],
                  ['sell'], 'A product-focused ad converts best with a clear purchase objective.'),
            _Spec('platform', 'Platform', 'Where will people see it?',
                  'Platform changes framing, duration, hook speed and derivatives.', 90, 'high', 'multi_select',
                  [('tiktok', 'TikTok / Reels', 'Vertical, fast hook'), ('youtube', 'YouTube', 'Flexible structure'),
                   ('website', 'Website', 'Product and brand context'), ('multiple', 'Multiple', 'Master plus derivatives')],
                  ['tiktok', 'multiple'], 'A social-first master with derivatives gives the most reusable plan.'),
        ],
        'wedding': [
            _Spec('deliverable', 'Deliverable', 'What do you want to leave with?',
                  'The deliverable determines the coverage plan TONDE builds.', 100, 'critical', 'multi_select',
                  [('highlight', 'Highlight film', 'Cinematic story of the day'),
                   ('ceremony', 'Full ceremony', 'Complete key moments'),
                   ('social', 'Social clips', 'Short vertical moments'),
                   ('photo_video', 'Photo + video', 'Plan both together')],
                  ['highlight', 'social'], 'A highlight film plus social clips gives a strong master story and immediate short-form output.'),
            _Spec('coverage_priority', 'Coverage priority', 'What matters most?',
                  'TONDE uses this to protect the moments that cannot be repeated.', 90, 'high', 'multi_select',
                  [('emotion', 'Emotion', 'Reactions and relationships'), ('ceremony', 'Ceremony', 'Vows and core moments'),
                   ('family', 'Family', 'People and connections'), ('party', 'Party', 'Energy and celebration')],
                  ['emotion', 'ceremony'], 'Emotion plus ceremony protects both the story and the unrepeatable moments.'),
            _Spec('event_duration', 'Time frame', 'How long is the main event?',
                  'Coverage length changes battery, media, audio and moment planning.', 70, 'medium', 'duration',
                  [('under_4', 'Under 4 hours', 'Short coverage'), ('4_6', '4 to 6 hours', 'Half day'),
                   ('6_10', '6 to 10 hours', 'Full day'), ('over_10', 'Over 10 hours', 'Extended day')],
                  ['6_10'], 'A full-day assumption is safest when the event length is still unknown.'),
        ],
        'event': [
            _Spec('coverage_scope', 'Coverage', 'What do you need from the event?',
                  'Scope decides crew attention across the day.', 100, 'critical', 'multi_select',
                  [('full_record', 'Full record', 'Capture the day completely'),
                   ('highlights', 'Highlights', 'Best-moments story'),
                   ('speakers', 'Speaker coverage', 'Talks and panels'),
                   ('social', 'Social content', 'Clips during the event')],
                  ['highlights', 'social'], 'Highlights plus social clips cover both the record and the reach.'),
            _Spec('key_moments', 'Key moments', 'What cannot be missed?',
                  'Unrepeatable moments get protected coverage first.', 90, 'high', 'multi_select',
                  [('keynote', 'Keynote', 'The main talk'), ('panels', 'Panels', 'Discussion sessions'),
                   ('reactions', 'Audience reactions', 'Emotion in the room'), ('announcements', 'Announcements', 'News moments')],
                  ['keynote', 'reactions'], 'The keynote plus audience reactions carry the event story.'),
        ],
        'sports': [
            _Spec('output', 'Output', 'What do you want from the game?',
                  'A full record, highlights and an athlete story need different coverage.', 100, 'critical', 'single_select',
                  [('highlights', 'Highlight reel', 'Best moments and momentum'),
                   ('athlete_story', 'Athlete story', 'Follow one person'),
                   ('team_story', 'Team story', 'Narrative of the game'),
                   ('full', 'Full coverage', 'Capture everything important')],
                  ['highlights'], 'A highlight reel is the strongest default when the final use is not yet specified.'),
            _Spec('focus', 'Focus', 'What can TONDE not afford to miss?',
                  'This decides where attention goes when the action becomes unpredictable.', 90, 'high', 'multi_select',
                  [('key_player', 'Key player', 'Prioritize one athlete'),
                   ('game_story', 'Game story', 'Turning points and result'),
                   ('crowd', 'Crowd and reactions', 'Emotion around the game'),
                   ('balanced', 'Balanced', 'Broad coverage')],
                  ['game_story', 'crowd'], 'Game story plus reactions captures both what happened and why it mattered.'),
        ],
        'documentary': [
            _Spec('driver', 'Documentary engine', 'What drives the film?',
                  'The driver sets research, interview, scene and evidence strategy.', 100, 'critical', 'single_select',
                  [('person', 'A person', 'Character-led'), ('question', 'A question', 'Inquiry-led'),
                   ('event', 'An event', 'Chronology-led'), ('issue', 'An issue', 'Argument and exploration')],
                  ['question'], 'A central question gives the documentary a strong spine.'),
            _Spec('access', 'Access', 'What do you already have access to?',
                  'Access changes what TONDE can responsibly design around.', 80, 'high', 'multi_select',
                  [('people', 'Subjects and people', 'Interview access'), ('locations', 'Locations', 'Places to film'),
                   ('research', 'Research and documents', 'Evidence and context'), ('nothing', 'Nothing yet', 'Start from research')],
                  ['nothing'], 'TONDE starts from research and builds the access plan progressively.'),
            _Spec('length', 'Length', 'How long should the finished piece be?',
                  'Runtime changes depth, research and interview scope.', 70, 'medium', 'duration',
                  [('short', '3 to 8 minutes', 'Short documentary'), ('focused', '10 to 20 minutes', 'Focused piece'),
                   ('long', '30 to 60 minutes', 'Long-form'), ('series', 'Series', 'Multiple chapters')],
                  ['focused'], 'A focused piece gives room for depth without overbuilding.'),
        ],
        'interview': [
            _Spec('subject', 'Subject', 'Who is this interview with, and about what?',
                  'The subject shapes the question arc and setup.', 100, 'critical', 'freeform', [],
                  [], ''),
            _Spec('length', 'Length', 'How long should the finished piece run?',
                  'Length decides how much of the conversation survives the edit.', 80, 'high', 'duration',
                  [('short', 'Under 5 minutes', 'Highlight cut'), ('focused', '5 to 15 minutes', 'Focused piece'),
                   ('long', 'Over 15 minutes', 'Long conversation')],
                  ['focused'], 'A focused cut keeps the strongest answers without padding.'),
        ],
        'music_video': [
            _Spec('concept', 'Concept', 'Should this be performance, story, or a blend?',
                  'The concept decides locations, coverage and edit rhythm.', 100, 'critical', 'single_select',
                  [('performance', 'Performance', 'Artist-led energy'), ('story', 'Story', 'Narrative arc'),
                   ('blend', 'Blend', 'Performance inside a story')],
                  ['blend'], 'A blend carries both the song energy and a memorable visual idea.'),
            _Spec('location', 'Location', 'Where should this live visually?',
                  'Location bounds what one shoot day can achieve.', 70, 'medium', 'single_select',
                  [('single', 'One location', 'Contained shoot'), ('few', 'A few locations', 'Small footprint'),
                   ('tonde', 'TONDE decides', 'Let TONDE propose')],
                  ['single'], 'One strong location keeps a music video shootable in a day.'),
        ],
        'photography': [
            _Spec('subject_matter', 'Subject', 'What are you trying to create?',
                  'The subject decides setups, moments and shot lists.', 100, 'critical', 'single_select',
                  [('portrait', 'Portrait set', 'People, directed'), ('event', 'Event coverage', 'Moments as they happen'),
                   ('product', 'Product campaign', 'Product as hero'), ('editorial', 'Editorial', 'Story-driven stills')],
                  ['portrait'], 'A directed portrait set is the most useful default plan.'),
            _Spec('usage', 'Usage', 'Where will these photographs live?',
                  'Usage changes framing, orientation and delivery count.', 80, 'high', 'multi_select',
                  [('social', 'Social', 'Feeds and stories'), ('print', 'Print', 'High-resolution delivery'),
                   ('web', 'Website', 'Brand and product context')],
                  ['social'], 'Social-first delivery covers the most common use.'),
        ],
        'social': [
            _Spec('angle', 'Angle', 'What should each video deliver?',
                  'The angle decides hook, structure and payoff.', 100, 'critical', 'single_select',
                  [('teach', 'Teach something', 'Clear takeaway'), ('story', 'Tell a story', 'Narrative pull'),
                   ('process', 'Show a process', 'Watch it happen'), ('entertain', 'Entertain', 'Pure watchability')],
                  ['story'], 'Story-driven short video holds attention past the hook.'),
            _Spec('platform', 'Platform', 'Where will people see it?',
                  'Platform changes framing and hook speed.', 90, 'high', 'multi_select',
                  [('tiktok', 'TikTok / Reels', 'Vertical, fast hook'), ('youtube', 'YouTube Shorts', 'Searchable shorts'),
                   ('multiple', 'Multiple', 'Master plus derivatives')],
                  ['tiktok', 'multiple'], 'Vertical-first with derivatives covers the most ground.'),
        ],
        'general': [
            _Spec('objective', 'Objective', 'What should this production accomplish?',
                  'The objective decides what TONDE designs toward.', 100, 'critical', 'single_select',
                  [('story', 'Tell a story', 'Narrative arc'), ('showcase', 'Showcase something', 'Subject as hero'),
                   ('document', 'Document something', 'Faithful record'), ('promote', 'Promote something', 'Drive action')],
                  ['story'], 'A story objective gives TONDE the clearest structure to build.'),
            _Spec('format', 'Format', 'What shape should this take?',
                  'Format changes structure, coverage and delivery.', 90, 'high', 'single_select',
                  [('short_video', 'Short video', 'Under 3 minutes'), ('film', 'Short film', 'Story-driven piece'),
                   ('series', 'Series', 'Multiple parts'), ('photos', 'Photography', 'Still images')],
                  ['short_video'], 'A short video is the most useful first shape for an open brief.'),
        ],
    }


# ---------------------------------------------------------------------------
# Answer interpretation: one natural-language answer may settle siblings.
# ---------------------------------------------------------------------------

_PLATFORM_TOKENS = (
    ('tiktok', 'TikTok / Reels'), ('reels', 'TikTok / Reels'), ('instagram', 'TikTok / Reels'),
    ('youtube', 'YouTube'), ('website', 'Website'), ('tv', 'TV / streaming'),
)

_DURATION_PATTERN = r'(?<!\d)(\d+(?:\.\d+)?)[\s-]*(seconds?|secs?|sec|minutes?|mins?|min|hours?|hrs?|hr)\b'
_COUNT_PATTERN = r'(?<!\d)(\d+)\s*(?:part|episode|episodes|photo|photos|shot|shots|video|videos)\b'

_WORD_NUMBERS = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6,
    'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12,
}
_WORD_COUNT_PATTERN = r'\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:part|episode|episodes|photo|photos|shot|shots|video|videos)\b'
_WORD_DURATION_PATTERN = r'\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(seconds?|secs?|sec|minutes?|mins?|min|hours?|hrs?|hr)\b'


def _duration_ms(amount: float, unit: str) -> str:
    unit = unit.lower()
    multiplier = 3600000 if unit.startswith('h') else 60000 if unit.startswith('min') else 1000
    return str(round(amount * multiplier))


def extract_answer_facts(text: str) -> dict[str, str]:
    """Pull sibling decisions out of freeform text (runtime, platform,
    counts). Conservative: only fills values the text states plainly."""
    found: dict[str, str] = {}
    lower = text.lower()
    runtime = director_domain._runtime(text)
    if runtime is not None:
        found['runtime'] = str(runtime)
    for token, label in _PLATFORM_TOKENS:
        if re.search(rf'\b{re.escape(token)}\b', lower):
            found.setdefault('platform', label)
            break
    count = re.search(_COUNT_PATTERN, lower)
    word_count = re.search(_WORD_COUNT_PATTERN, lower)
    if count:
        found['episode_count'] = count.group(1)
    elif word_count:
        found['episode_count'] = str(_WORD_NUMBERS[word_count.group(1)])
    if 'episode_count' in found:
        per_unit = re.search(r'(?:about|around|~|roughly)\s*' + _DURATION_PATTERN, lower)
        word_unit = re.search(r'(?:about|around|~|roughly)\s*' + _WORD_DURATION_PATTERN, lower)
        if per_unit:
            found['episode_length'] = _duration_ms(float(per_unit.group(1)), per_unit.group(2))
        elif word_unit:
            found['episode_length'] = _duration_ms(float(_WORD_NUMBERS[word_unit.group(1)]), word_unit.group(2))
    if re.search(r'\bvertical\b', lower):
        found['aspect_ratio'] = '9:16'
    return found


def seed_from_goal(goal: str, family: str) -> dict[str, str]:
    """Settle decisions the goal itself states plainly (user provenance).
    Only distinctive tokens seed a decision; ambiguity always asks."""
    lower = goal.lower()
    seeds: dict[str, str] = {}
    if family in {'narrative', 'series'}:
        if 'series' in lower or 'episodes' in lower:
            seeds['format'] = 'Episodic series'
        elif 'short film' in lower or 'short-video' in lower or 'short video' in lower:
            seeds['format'] = 'Short film'
        elif 'feature' in lower:
            seeds['format'] = 'Feature'
        if 'mystery' in lower:
            seeds['direction'] = 'Dark mystery'
        elif re.search(r'\baction\b', lower):
            seeds['direction'] = 'High-energy action'
        elif 'horror' in lower:
            seeds['direction'] = 'Grounded horror'
        if re.search(r'discover\w*\s+why|why\s+everyone|what\s+happened', lower):
            seeds['story_engine'] = 'What happened?'
        elif re.search(r'surviv', lower):
            seeds['story_engine'] = 'Can she survive?'
    if family == 'wedding':
        deliverables: list[str] = []
        if 'highlight' in lower:
            deliverables.append('Highlight film')
        if 'social' in lower:
            deliverables.append('Social clips')
        if 'full ceremony' in lower or 'entire ceremony' in lower:
            deliverables.append('Full ceremony')
        if deliverables:
            seeds['deliverable'] = ' + '.join(deliverables)
    if family == 'commercial' and ('sell' in lower or 'drive purchase' in lower or 'drive sales' in lower):
        seeds['objective'] = 'Sell product'
    for key, value in extract_answer_facts(goal).items():
        seeds.setdefault(key, value)
    return seeds


# ---------------------------------------------------------------------------
# Gap analysis: the engine itself.
# ---------------------------------------------------------------------------

def _answered(answered: dict[str, str], decision_id: str) -> str | None:
    value = answered.get(decision_id)
    if value is None or not str(value).strip():
        return None
    return str(value)


def _context_reason(reason: str, intent: ProductionIntent) -> str:
    """Ground a recommendation reason in actual known values where available."""
    parts = [reason]
    if intent.subject:
        parts.append(f'You named {intent.subject} as the subject.')
    if intent.platform:
        parts.append(f'Delivery is already set for {intent.platform}.')
    if intent.runtime_ms is not None:
        parts.append(f'The stated runtime is {_format_ms(intent.runtime_ms)}.')
    return ' '.join(parts)


def analyze_intake(
    goal: str,
    intent: ProductionIntent,
    *,
    answered: dict[str, str] | None = None,
    reference_mechanics: list[str] | None = None,
    story_material: bool = False,
    setup_names: list[str] | None = None,
    collaboration_mode: str = 'stop_at_major_decisions',
) -> IntakeAnalysis:
    """Run gap analysis over the current intake state. Re-run after every
    answer: answered unknowns drop out, and newly exposed ambiguities appear."""
    answers = {str(key): str(value) for key, value in (answered or {}).items()}
    # Freeform answers may carry sibling facts (runtime, platform, counts).
    # Track their provenance so extracted answers are never presented as stated.
    extracted: dict[str, str] = {}
    for answer_text in list(answers.values()):
        for key, fact in extract_answer_facts(answer_text).items():
            if key not in answers:
                answers[key] = fact
                extracted[key] = fact
    family = classify_family(intent, goal, answers)
    known = build_known_facts(intent, goal, [])
    inferred = build_inferred_facts(intent, goal, family, reference_mechanics or [], story_material)

    # Reference-supplied direction removes the need to ask for it.
    direction_covered = bool(reference_mechanics)

    specs = list(_family_specs().get(family, _family_specs()['general']))
    if family == 'narrative' and intent.primary_type in {ProductionType.series, ProductionType.recurring_content}:
        specs = [spec for spec in specs if spec.decision_id not in {'format', 'episode_count'}]
        goal_lower = goal.lower()
        explicit_count = re.search(r'\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[ -]?(?:part|episode|episodes)\b', goal_lower)
        if explicit_count:
            answers.setdefault('episode_count', explicit_count.group(0))
        if re.search(r'\b(?:dark|mystery|horror|survival|action|thriller|comedy|romance)\b', goal_lower):
            specs = [spec for spec in specs if spec.decision_id != 'direction']
        if re.search(r'\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:seconds?|minutes?|mins?|hours?)\s*(?:per|each)\s+episode\b', goal_lower) or re.search(r'\b(?:per|each)\s+episode\s*(?:about|around)?\s*\d', goal_lower):
            specs = [spec for spec in specs if spec.decision_id != 'episode_length']
        narrative_words = sum(token in goal_lower for token in ('zombie', 'girl', 'survive', 'survival', 'kenya', 'city', 'outbreak', 'epic', 'horror', 'mystery'))
        has_narrative_seed = bool(intent.subject or extract_setting(goal) or narrative_words >= 3)
        story_engine = next((spec for spec in specs if spec.decision_id == 'story_engine'), None)
        if story_engine and re.search(r'\b(?:discover\w*\s+why|why\s+everyone|what\s+happened)\b', goal_lower):
            answers.setdefault('story_engine', 'What happened?')
            story_engine.decision_id = 'story_engine'
        elif story_engine and re.search(r'\bsurviv\w*\b', goal_lower):
            answers.setdefault('story_engine', 'Can she survive?')
            story_engine.decision_id = 'story_engine'
        episode_length = next((spec for spec in specs if spec.decision_id == 'episode_length'), None)
        if episode_length and intent.runtime_ms is None and not answers.get('episode_length') and not answers.get('runtime'):
            episode_length.topic = 'Episode runtime'
            episode_length.question = 'How long should each episode feel?'
            episode_length.why = 'Episode runtime determines Card count, pacing and Shot structure.'
            episode_length.options = [('1_2', '1–2 minutes', 'Short-form episodes'), ('3_5', '3–5 minutes', 'Room for a developed beat'),
                ('8_10', '8–10 minutes', 'Longer episode arc'), ('tonde', 'TONDE DECIDE', 'Let TONDE choose')]
            episode_length.recommend = ['3_5']
            episode_length.reason = 'Three to five minutes leaves room for one meaningful episode turn without padding.'
        elif episode_length and intent.runtime_ms is not None:
            answers.setdefault('episode_length', str(intent.runtime_ms))
        elif episode_length and answers.get('runtime'):
            answers.setdefault('episode_length', answers['runtime'])
        elif episode_length and extracted.get('episode_length'):
            answers.setdefault('episode_length', extracted['episode_length'])
            episode_length.topic = 'Episode runtime'
            episode_length.question = 'How long should each episode feel?'
            episode_length.why = 'Episode runtime determines Card count, pacing and Shot structure.'
            episode_length.options = [('1_2', '1–2 minutes', 'Short-form episodes'), ('3_5', '3–5 minutes', 'Room for a developed beat'),
                ('8_10', '8–10 minutes', 'Longer episode arc'), ('tonde', 'TONDE DECIDE', 'Let TONDE choose')]
            episode_length.recommend = ['3_5']
            episode_length.reason = 'Three to five minutes leaves room for one meaningful episode turn without padding.'
        if not intent.subject and not story_material and not answers.get('premise') and has_narrative_seed:
            # A detailed premise already exists in the goal; only material questions remain.
            specs = [spec for spec in specs if spec.decision_id != 'premise']
        elif not intent.subject and not story_material and not answers.get('premise'):
            specs = [spec for spec in specs if spec.decision_id not in {'format', 'direction', 'story_engine', 'episode_length', 'execution'}]
            specs.insert(0, _Spec('premise', 'Premise', 'What is the central idea or premise?',
                'A premise gives the first story structure a clear dramatic direction.', 110, 'critical', 'freeform', [], [], ''))
    if family == 'narrative' and intent.primary_type in {ProductionType.series, ProductionType.recurring_content}:
        specs = [spec for spec in specs if spec.decision_id != 'episode_count']
        if extracted.get('episode_length'):
            specs = [spec for spec in specs if spec.decision_id != 'premise']
        if intent.runtime_ms is not None or answers.get('runtime'):
            specs = [spec for spec in specs if spec.decision_id != 'episode_length']
        elif extracted.get('episode_length') and not any(spec.decision_id == 'episode_length' for spec in specs):
            specs.append(_Spec('episode_length', 'Episode runtime', 'How long should each episode feel?',
                'Episode runtime determines Card count, pacing and Shot structure.', 88, 'high', 'duration',
                [('1_2', '1–2 minutes', 'Short-form episodes'), ('3_5', '3–5 minutes', 'Room for a developed beat'),
                 ('8_10', '8–10 minutes', 'Longer episode arc'), ('tonde', 'TONDE DECIDE', 'Let TONDE choose')], ['3_5'],
                'Three to five minutes leaves room for one meaningful episode turn without padding.'))
        if answers.get('story_engine'):
            specs = [spec for spec in specs if spec.decision_id != 'story_engine']
        if answers.get('direction'):
            specs = [spec for spec in specs if spec.decision_id != 'direction']
        if intent.primary_type == ProductionType.series and not any(spec.decision_id == 'execution' for spec in specs):
            specs.append(_Spec('execution', 'Execution', 'How will you make this Production?',
                'Execution changes character, camera and generation direction.', 86, 'high', 'single_select',
                [('real', 'REAL', 'Shoot with physical people and equipment'), ('ai', 'AI', 'Use TONDE’s playbook in your own AI tool'),
                 ('hybrid', 'HYBRID', 'Assign real and AI execution per Shot'), ('tonde_decides', 'TONDE DECIDE', 'Ask TONDE to recommend a mode')],
                ['tonde_decides'], 'Choose after considering the Production and available resources.'))
    if direction_covered:
        specs = [spec for spec in specs if spec.decision_id != 'direction']
    narrative_words = sum(token in goal.lower() for token in ('zombie', 'girl', 'survive', 'survival', 'kenya', 'city', 'outbreak', 'epic'))
    has_narrative_seed = bool(intent.subject or extract_setting(goal) or narrative_words >= 3)
    if family == 'narrative' and intent.primary_type in {ProductionType.series, ProductionType.recurring_content} and intent.runtime_ms is None and not answers.get('episode_length') and not answers.get('runtime') and not any(spec.decision_id == 'episode_length' for spec in specs):
        specs.append(_Spec('episode_length', 'Episode runtime', 'How long should each episode feel?',
            'Episode runtime determines Card count, pacing and Shot structure.', 88, 'high', 'duration',
            [('1_2', '1–2 minutes', 'Short-form episodes'), ('3_5', '3–5 minutes', 'Room for a developed beat'),
             ('8_10', '8–10 minutes', 'Longer episode arc'), ('tonde', 'TONDE DECIDE', 'Let TONDE choose')], ['3_5'],
            'Three to five minutes leaves room for one meaningful episode turn without padding.'))
    if family == 'narrative' and intent.primary_type == ProductionType.series and intent.execution is None and not answers.get('execution') and not any(spec.decision_id == 'execution' for spec in specs):
        specs.append(_Spec('execution', 'Execution', 'How will you make this Production?',
            'Execution changes the real/AI/Hybrid direction and resource checks.', 86, 'high', 'single_select',
            [('real', 'REAL', 'Shoot with physical people and equipment'), ('ai', 'AI', 'Use an external AI tool and TONDE playbook'),
             ('hybrid', 'HYBRID', 'Assign real and AI execution per Shot'), ('tonde_decides', 'TONDE DECIDE', 'Let TONDE recommend after checking resources')],
            ['tonde_decides'], 'TONDE can recommend only after the Production Kit and plan are considered.'))
    if family == 'narrative' and not intent.subject and not story_material and not answers.get('premise') and not has_narrative_seed and not any(spec.decision_id == 'premise' for spec in specs):
        specs.insert(0, _Spec('premise', 'Premise', 'What is the central idea or premise?',
            'A premise gives the first story structure a clear dramatic direction.', 110, 'critical', 'freeform', [], [], ''))
    if family == 'narrative' and not intent.subject and not story_material and not answers.get('premise') and has_narrative_seed:
        specs = [spec for spec in specs if spec.decision_id != 'premise']
    if family == 'narrative' and intent.primary_type == ProductionType.custom and not intent.subject and not answers.get('premise'):
        # Preserve premise-first behavior for a specific but not yet classified story idea.
        specs = [spec for spec in specs if spec.decision_id not in {'format', 'direction', 'story_engine', 'execution'}]
        specs.insert(0, _Spec('premise', 'Premise', 'What is the central idea or premise?',
            'A premise gives the first story structure a clear dramatic direction.', 110, 'critical', 'freeform', [], [], ''))
    elif family == 'narrative' and intent.primary_type == ProductionType.custom:
        specs = _family_specs()['narrative']
        specs = [spec for spec in specs if spec.decision_id != 'format']
        specs.insert(0, _Spec('format', 'Scale', 'How big should this story be?',
            'The story material gives TONDE enough to choose scale without repeating its central mystery.', 100, 'critical', 'single_select',
            [('short_video', 'Short video', '30 seconds to 3 minutes, one arc'), ('short_film', 'Short film', '5 to 20 minutes, full story'),
             ('series', 'Episodic series', 'Multiple parts with reveals'), ('feature', 'Feature', 'Long-form movie')],
            ['series'], 'The mystery revealed in the supplied premise can unfold over episodes.'))
    elif family == 'narrative' and intent.primary_type == ProductionType.custom and answers.get('premise'):
        specs = [spec for spec in specs if spec.decision_id != 'premise']
        specs = _family_specs()['narrative']
        if direction_covered:
            specs = [spec for spec in specs if spec.decision_id != 'direction']
        specs = [spec for spec in specs if spec.decision_id not in {'format', 'episode_count'}]
    elif family == 'narrative' and not intent.subject and not story_material and not answers.get('premise') and has_narrative_seed:
        specs = [spec for spec in specs if spec.decision_id != 'premise']
    if intent.primary_type in {ProductionType.commercial, ProductionType.advertisement, ProductionType.product_film} and 'execution' not in answers and not any(spec.decision_id == 'execution' for spec in specs):
        specs.append(_Spec('execution', 'Execution', 'How will you make this Production?',
            'Execution changes resource requirements and Shot direction.', 86, 'high', 'single_select',
            [('real', 'REAL', 'Shoot with physical people and equipment'),
             ('ai', 'AI', 'Use an external AI tool and TONDE playbook'),
             ('hybrid', 'HYBRID', 'Combine real and AI Shots'),
             ('tonde_decides', 'TONDE DECIDE', 'Let TONDE recommend after checking resources')],
            ['tonde_decides'], 'The Production Kit and required product fidelity shape this recommendation.'))

    if intent.execution is None and 'execution' not in answers and not any(spec.decision_id == 'execution' for spec in specs) and not (family == 'narrative' and intent.primary_type == ProductionType.custom and answers.get('premise')):
        specs.append(_Spec('execution', 'Execution', 'How will you make this Production?',
            'Real, AI and Hybrid require different Shot directions and resource checks.', 86, 'high', 'single_select',
            [('real', 'REAL', 'Shoot with physical people and equipment'),
             ('ai', 'AI', 'Use an external AI tool and TONDE playbook'),
             ('hybrid', 'HYBRID', 'Assign real and AI execution per Shot'),
             ('tonde_decides', 'TONDE DECIDE', 'Let TONDE recommend after checking resources')],
            ['tonde_decides'], 'Choose after considering this Production and the creator\'s actual resources.'))

    if answers.get('execution') and answers['execution'].strip().lower() not in {'tonde decides', 'tonde decide', 'tonde_decides'}:
        specs = [spec for spec in specs if spec.decision_id != 'execution']
    elif answers.get('execution') and answers['execution'].strip().lower() in {'tonde decides', 'tonde decide', 'tonde_decides'}:
        specs = [spec for spec in specs if spec.decision_id != 'execution']
        from app.domain.vocabulary import ExecutionMethod
        specs = [spec for spec in specs if spec.decision_id != 'execution_recommendation']
        setup_lower = [str(name).lower() for name in (setup_names or [])]
        ai_available = any(any(token in name for token in ('ai', 'runway', 'veo', 'sora', 'kling')) for name in setup_lower)
        physical_available = any(any(token in name for token in ('camera', 'phone', 'lighting', 'light', 'audio')) for name in setup_lower)
        recommendation = ExecutionMethod.hybrid.value if ai_available and physical_available else ExecutionMethod.real.value if physical_available or not ai_available else ExecutionMethod.ai.value
        answers['execution_recommendation'] = recommendation
        extracted['execution_recommendation'] = recommendation
        specs.insert(0, _Spec('execution_recommendation', 'Execution recommendation', 'TONDE recommends an execution strategy',
            'This is a recommendation based on the listed Production Kit; the creator may change it.', 86, 'high', 'single_select',
            [('real', 'REAL', 'Shoot with physical people and equipment'), ('ai', 'AI', 'Use an external AI tool and TONDE playbook'), ('hybrid', 'HYBRID', 'Assign real and AI execution per Shot')],
            [recommendation], 'Based on declared kit only; unknown/unlisted resources stay unknown.'))
    if answers.get('runtime') == 'TONDE decides' and intent.runtime_ms is None:
        specs = [spec for spec in specs if spec.decision_id != 'runtime']
        answers['runtime'] = '30000'
        extracted['runtime'] = '30000'
    if answers.get('episode_length') == 'TONDE DECIDE' and intent.runtime_ms is None:
        specs = [spec for spec in specs if spec.decision_id != 'episode_length']
        answers['episode_length'] = '180000'
        extracted['episode_length'] = '180000'

    if direction_covered:
        specs = [spec for spec in specs if spec.decision_id != 'direction']

    if direction_covered:
        specs = [spec for spec in specs if spec.decision_id != 'direction']
    if family == 'narrative' and not answers.get('premise') and not extracted.get('episode_length') and any(
            spec.decision_id == 'premise' for spec in specs):
        # The premise gates everything downstream: ask it first, alone. The
        # re-run after its answer produces the remaining queue.
        specs = [spec for spec in specs if spec.decision_id == 'premise']

    # Resource conflicts surface only when the tradeoff is material.
    setup_lower = [str(name).lower() for name in (setup_names or [])]
    wants_aerial = any(word in goal.lower() for word in ('aerial', 'drone'))
    has_drone = any('drone' in name for name in setup_lower)
    if wants_aerial and not has_drone and not answers.get('aerial_tradeoff'):
        specs.append(_Spec(
            'aerial_tradeoff', 'Aerial tradeoff',
            'You asked for aerial footage but no drone is listed. How should TONDE handle that?',
            'This changes what the opening and establishing coverage can be.', 85, 'high', 'single_select',
            [('adapt', 'Adapt to what I have', 'Same feeling, no drone'),
             ('plan_gear', 'Plan for additional gear', 'Design around a rental or operator')],
            ['adapt'], 'Adapting preserves the feeling of the brief using equipment you can actually access.'))

    # The goal itself settles decisions it states plainly (user provenance,
    # lowest priority: explicit answers always win).
    for key, seed in seed_from_goal(goal, family).items():
        answers.setdefault(key, seed)
    unknowns: list[MaterialDecision] = []
    for spec in specs:
        raw: str | None = _answered(answers, spec.decision_id)
        # Multi-select decisions are covered when the answer names an option.
        if raw is not None and spec.answer_mode == 'multi_select' and spec.options:
            matched = [label for _, label, _ in spec.options if label.lower() in raw.lower()]
            raw = ' + '.join(matched) if matched else None
        # Intent-level fields also settle decisions (asked once, never again).
        by: Literal['creator', 'tonde', 'extracted'] = 'creator'
        if spec.decision_id == 'execution' and raw is not None and raw.strip().lower() in {'tonde decides', 'tonde decide', 'tonde_decides'}:
            raw = None
        if raw is None and spec.decision_id == 'platform' and intent.platform:
            raw = intent.platform
        elif raw is None and spec.decision_id == 'runtime' and intent.runtime_ms is not None:
            raw = str(intent.runtime_ms)
        elif raw is None and spec.decision_id == 'execution' and intent.execution is not None:
            raw = intent.execution.value.upper()
        elif raw is None and spec.decision_id == 'episode_length' and answers.get('runtime'):
            raw = answers['runtime']
            by = 'extracted' if extracted.get('runtime') == raw else 'creator'
        elif raw is None and spec.decision_id == 'episode_length' and answers.get('episode_length'):
            raw = answers['episode_length']
            by = 'extracted' if extracted.get('episode_length') == raw else 'creator'
        elif raw is None and spec.decision_id == 'execution_recommendation' and answers.get('execution_recommendation'):
            raw = answers['execution_recommendation'].upper()
            by = 'tonde'
        elif raw is None and spec.decision_id == 'dialogue_mode' and intent.dialogue_mode:
            raw = str(intent.dialogue_mode)
        elif raw is None and spec.decision_id == 'product' and intent.product_named and intent.subject:
            raw = intent.subject
        elif raw is not None:
            lowered = raw.strip().lower()
            by = 'tonde' if lowered in {'tonde decides', 'tonde decide', 'tonde_decides'} else ('extracted' if extracted.get(spec.decision_id) == raw else 'creator')
        elif spec.decision_id == 'episode_length' and answers.get('episode_length'):
            raw = answers['episode_length']
            by = 'extracted' if extracted.get(spec.decision_id) == raw else 'creator'
        value: str | None = raw
        if value is not None:
            unknowns.append(MaterialDecision(
                decision_id=spec.decision_id, topic=spec.topic, question=spec.question, why=spec.why,
                answer_mode=spec.answer_mode,
                options=[DecisionOption(id=oid, label=label, description=desc) for oid, label, desc in spec.options],
                recommendation=DecisionRecommendation(option_ids=list(spec.recommend), reason=_context_reason(spec.reason, intent)),
                rank=spec.rank, state='tonde_decided' if by == 'tonde' else 'answered',
                impact=spec.impact, answer=value,
                answered_by=by))
            continue
        unknowns.append(MaterialDecision(
            decision_id=spec.decision_id, topic=spec.topic, question=spec.question, why=spec.why,
            answer_mode=spec.answer_mode,
            options=[DecisionOption(id=oid, label=label, description=desc) for oid, label, desc in spec.options],
            recommendation=DecisionRecommendation(option_ids=list(spec.recommend), reason=_context_reason(spec.reason, intent)),
            rank=spec.rank, state='open', impact=spec.impact))

    open_unknowns = sorted(
        [item for item in unknowns if item.state == 'open'],
        key=lambda item: -item.rank,
    )
    if collaboration_mode == 'complete_first_draft':
        # TONDE carries the non-blocking decisions itself; the creator only
        # stops the build for critical ones.
        open_unknowns = [item for item in open_unknowns if item.impact == 'critical']
    open_unknowns = open_unknowns[:MAX_OPEN_DECISIONS]
    enough = len(open_unknowns) == 0
    summary, creative_facts = compose_creative_direction(family, intent, answers, known)
    return IntakeAnalysis(
        production_family=family,
        known=known,
        inferred=inferred,
        deferred=list(DEFERRED_TOPICS),
        material_unknowns=open_unknowns,
        decisions=unknowns,
        enough_to_direct=enough,
        blocking_open=sum(1 for item in open_unknowns if item.impact == 'critical'),
        creative_direction_summary=summary if enough else '',
        creative_facts=creative_facts if enough else [],
        producer='deterministic',
    )


def compose_creative_direction(
    family: str, intent: ProductionIntent, answers: dict[str, str], known: list[IntakeFact],
) -> tuple[str, list[str]]:
    """A concise natural-language statement of what TONDE is about to build.
    Only facts and confirmed answers feed it -- never speculative defaults."""
    goal = intent.goal.strip()
    bits: list[str] = []

    def answer(*ids: str) -> str | None:
        for decision_id in ids:
            value = answers.get(decision_id)
            if value and str(value).strip().lower() != 'tonde decides':
                return str(value)
        return None

    subject = intent.subject or answer('product', 'subject', 'premise')
    runtime_ms = intent.runtime_ms
    runtime_answer = answers.get('runtime') or answers.get('episode_length')
    if runtime_ms is None and runtime_answer:
        try:
            runtime_ms = int(runtime_answer)
        except (TypeError, ValueError):
            runtime_ms = director_domain._runtime(str(runtime_answer))
    runtime = _format_ms(runtime_ms) if runtime_ms is not None else None
    execution = intent.execution.value.upper() if intent.execution is not None else answer('execution')
    story_engine = answer('story_engine') or ('survival + discovery' if any(token in goal.lower() for token in ('zombie', 'survival', 'outbreak')) else None)
    setting = next((fact.value for fact in known if fact.key == 'setting'), None)
    platform = intent.platform or answer('platform')

    if family == 'commercial':
        objective = answer('objective') or 'a clear commercial idea'
        bits.append(f'A commercial designed to {objective.lower()}')
        if subject:
            bits.append(f'for {subject}')
    elif family == 'wedding':
        deliverable = answer('deliverable') or 'a wedding film'
        bits.append(f'A wedding production centered on {str(deliverable).lower()}')
    elif family in {'sports', 'event'}:
        output = answer('output', 'coverage_scope') or 'event coverage'
        bits.append(f'A production built around {str(output).lower()}')
    elif family == 'documentary':
        driver = answer('driver') or 'its central question'
        bits.append(f'A documentary driven by {str(driver).lower()}')
    elif family == 'series':
        count = answer('episode_count') or 'its first episodes'
        bits.append(f'A series planned around {str(count).lower()}')
    elif family == 'photography':
        subject_matter = answer('subject_matter') or (subject or 'its subject')
        bits.append(f'A photography production centered on {str(subject_matter).lower()}')
    elif family == 'narrative':
        direction = answer('direction')
        subject_text = subject or 'the central character'
        premise = answer('premise')
        if premise:
            concept = premise
        else:
            concept = f'{subject_text} in a {"zombie survival" if "zombie" in goal.lower() else "narrative"} story'
        if story_engine and story_engine not in concept:
            concept += f' driven by {story_engine}'
        if setting and setting.lower() not in concept.lower():
            concept += f' in {setting}'
        if direction and direction.lower() not in concept.lower():
            concept += f', with {direction.lower()} direction'
        bits.append(f'A narrative series built around {concept}')
    else:
        direction = answer('direction')
        concept = (direction or goal[:220]).strip()
        bits.append(f'A production built around {concept}')

    tail: list[str] = []
    if runtime:
        tail.append(f'runs {runtime}')
    if platform:
        tail.append(f'built for {platform}')
    if execution and execution.lower() not in {'tonde decide', 'tonde_decides'}:
        tail.append(f'{execution} execution')
    if intent.constraints.hard_constraints:
        tail.append(f'designed around {intent.constraints.hard_constraints[0].lower()}')
    summary = ' '.join(bits) + ('. ' + '. '.join(tail) + '.' if tail else '.')

    facts: list[str] = []
    if subject:
        facts.append(subject)
    for key in ('format', 'direction', 'story_engine', 'objective', 'deliverable',
                'coverage_priority', 'output', 'focus', 'driver', 'episode_count', 'subject_matter', 'execution', 'story_engine'):
        value = answer(key)
        if value and all(value.lower() not in fact.lower() for fact in facts):
            facts.append(str(value))
    if runtime:
        facts.append(runtime)
    if platform:
        facts.append(platform)
    setting = next((fact.value for fact in known if fact.key == 'setting'), None)
    if setting and all(setting.lower() not in fact.lower() for fact in facts):
        facts.append(setting)
    return summary, facts[:8]


def decision_to_brief_payload(decision: MaterialDecision) -> dict[str, Any]:
    """Shape a material decision for clients that render brief questions."""
    answer = decision.answer
    if decision.decision_id == 'runtime' and answer and str(answer).strip().isdigit():
        answer = _format_ms(int(str(answer).strip()))
    return {
        'id': decision.decision_id, 'topic': decision.topic, 'question': decision.question, 'why': decision.why,
        'answer_mode': decision.answer_mode,
        'options': [{'id': option.id, 'label': option.label, 'description': option.description}
                    for option in decision.options],
        'recommendation': {'option_ids': decision.recommendation.option_ids, 'reason': decision.recommendation.reason},
        'state': decision.state, 'impact': decision.impact,
        'answer': answer, 'answered_by': decision.answered_by,
        'allow_tonde_decides': True,
        'blocking': decision.impact == 'critical',
        'answered': decision.state != 'open',
    }
