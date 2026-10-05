from __future__ import annotations

from enum import StrEnum
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field, SecretStr

from app.core.config import Settings
from app.core.errors import AppError


class ProviderModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ProviderCapability(StrEnum):
    structured_text = 'structured_text'
    multimodal_image = 'multimodal_image'
    multimodal_frames = 'multimodal_frames'
    long_context = 'long_context'
    transcription = 'transcription'


class ProviderCapabilities(ProviderModel):
    provider: str = Field(min_length=1, max_length=80)
    capabilities: list[ProviderCapability] = Field(default_factory=list)
    model_profile: str = Field(default='unconfigured', max_length=120)
    max_timeout_seconds: float = Field(default=30, gt=0, le=600)
    max_context_tokens: int = Field(default=0, ge=0)
    notes: list[str] = Field(default_factory=list, max_length=8)

    def supports(self, capability: ProviderCapability) -> bool:
        return capability in self.capabilities

    @property
    def configured(self) -> bool:
        return bool(self.capabilities)


class ImageInput(ProviderModel):
    """Frames and images inherit the authorization of their source Reference."""

    kind: str = Field(default='image', pattern=r'^(image|frame)$')
    media_type: str = Field(default='image/png', max_length=60)
    data_base64: str = Field(min_length=8, max_length=8_000_000)
    label: str = Field(default='', max_length=200)
    timecode_ms: int | None = Field(default=None, ge=0, le=9007199254740991)


class GenerationRequest(ProviderModel):
    operation: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=200_000)
    system: str = Field(default='', max_length=20_000)
    response_schema: dict[str, Any] = Field(default_factory=dict)
    schema_name: str = Field(default='structured_output', max_length=80)
    images: list[ImageInput] = Field(default_factory=list, max_length=24)
    long_context: bool = False
    max_output_tokens: int = Field(default=4000, ge=64, le=64000)
    timeout_seconds: float = Field(default=30, gt=0, le=600)
    idempotency_key: str | None = Field(default=None, max_length=200)
    repair_attempt: int = Field(default=0, ge=0, le=3)
    repair_feedback: str = Field(default='', max_length=4000)


class GenerationResult(ProviderModel):
    output: dict[str, Any]
    provider: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=120)
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    attempts: int = Field(default=1, ge=1, le=10)
    repaired: bool = False
    latency_ms: int = Field(default=0, ge=0)


class TranscriptSegment(ProviderModel):
    index: int = Field(ge=0, le=5000)
    start_ms: int = Field(ge=0, le=9007199254740991)
    end_ms: int = Field(ge=0, le=9007199254740991)
    text: str = Field(default='', max_length=4000)
    speaker: str | None = Field(default=None, max_length=80)


class TranscriptionRequest(ProviderModel):
    operation: str = Field(default='transcription', max_length=80)
    media_type: str = Field(max_length=60)
    data: bytes = Field(min_length=1)
    filename: str = Field(default='audio', max_length=120)
    language: str | None = Field(default=None, max_length=12)
    timeout_seconds: float = Field(default=60, gt=0, le=600)
    idempotency_key: str | None = Field(default=None, max_length=200)


class TranscriptionResult(ProviderModel):
    text: str = Field(default='', max_length=200_000)
    segments: list[TranscriptSegment] = Field(default_factory=list, max_length=5000)
    language: str | None = Field(default=None, max_length=12)
    provider: str = Field(min_length=1, max_length=80)
    model: str = Field(min_length=1, max_length=120)
    duration_ms: int | None = Field(default=None, ge=0, le=9007199254740991)
    speaker_segmentation: bool = False


class ProviderMalformedOutput(Exception):
    """The provider answered, but the answer could not be parsed into the requested structure."""


class ProviderUnavailable(Exception):
    """No capable provider is configured or reachable."""


class ProviderFailed(Exception):
    """The provider was reachable but the operation failed or timed out."""

    def __init__(self, message: str, *, retryable: bool = True) -> None:
        super().__init__(message)
        self.retryable = retryable


class DirectorModelProvider(Protocol):
    """Server-only contract. Routes never talk to a model SDK directly."""

    def capabilities(self) -> ProviderCapabilities: ...

    async def generate(self, request: GenerationRequest) -> GenerationResult: ...

    async def transcribe(self, request: TranscriptionRequest) -> TranscriptionResult: ...


class UnconfiguredDirectorProvider:
    """Explicit absence of a provider. Never returns canned creative analysis."""

    def __init__(self, note: str = 'No AI provider is configured for this deployment.') -> None:
        self.note = note

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(provider='unconfigured', capabilities=[], model_profile='unconfigured', notes=[self.note])

    async def generate(self, request: GenerationRequest) -> GenerationResult:
        raise ProviderUnavailable(self.note)

    async def transcribe(self, request: TranscriptionRequest) -> TranscriptionResult:
        raise ProviderUnavailable(self.note)


def provider_settings_summary(settings: Settings) -> dict[str, Any]:
    return {
        'provider': settings.director_provider,
        'base_url_configured': bool(settings.director_base_url),
        'api_key_configured': settings.director_api_key is not None,
        'model_profile': settings.director_model_profile,
        'model': settings.director_model,
        'timeout_seconds': settings.director_timeout_seconds,
        'max_repair_attempts': settings.director_max_repair_attempts,
        'transcription_model': settings.director_transcription_model,
    }


def build_provider(settings: Settings, *, http_client: Any = None) -> DirectorModelProvider:
    """Config-driven provider selection. Unknown providers degrade to an explicit unconfigured state."""

    if settings.director_provider == 'unconfigured' or not settings.director_provider:
        return UnconfiguredDirectorProvider()
    if settings.director_provider == 'openai_compatible':
        if not settings.director_base_url or settings.director_api_key is None or not settings.director_model:
            return UnconfiguredDirectorProvider(
                'The configured AI provider is incomplete: base URL, API key and model are all required.'
            )
        from app.services.ai.openai_compatible import OpenAICompatibleProvider
        return OpenAICompatibleProvider(
            base_url=settings.director_base_url,
            api_key=settings.director_api_key,
            model=settings.director_model,
            transcription_model=settings.director_transcription_model,
            timeout_seconds=settings.director_timeout_seconds,
            max_timeout_seconds=settings.director_max_timeout_seconds,
            model_profile=settings.director_model_profile,
            http_client=http_client,
        )
    return UnconfiguredDirectorProvider(f'Provider "{settings.director_provider}" is not implemented by TONDE.')


def require_capability(capabilities: ProviderCapabilities, capability: ProviderCapability) -> None:
    if not capabilities.supports(capability):
        raise AppError(
            'DIRECTOR_PROVIDER_CAPABILITY_MISSING', 'provider',
            'The configured AI provider does not support this analysis. Nothing was changed; add details manually or configure a capable provider.',
            503,
        )


def provider_api_key(value: SecretStr | None) -> str | None:
    return value.get_secret_value() if value is not None else None
