from __future__ import annotations

import json
import time
from typing import Any

import httpx
from pydantic import SecretStr

from app.services.ai.provider import (
    GenerationRequest,
    GenerationResult,
    ProviderCapability,
    ProviderCapabilities,
    ProviderFailed,
    ProviderMalformedOutput,
    TranscriptionRequest,
    TranscriptionResult,
    TranscriptSegment,
)


class OpenAICompatibleProvider:
    """A provider-neutral HTTP adapter for OpenAI-compatible chat and transcription endpoints.

    The domain layer never imports a model SDK: requests and responses are plain structured data.
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_key: SecretStr,
        model: str,
        transcription_model: str | None,
        timeout_seconds: float = 30,
        max_timeout_seconds: float = 180,
        model_profile: str = 'default',
        long_context_model: str | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.model = model
        self.long_context_model = long_context_model
        self.transcription_model = transcription_model
        self.timeout_seconds = timeout_seconds
        self.max_timeout_seconds = max_timeout_seconds
        self.model_profile = model_profile
        self._client = http_client
        self._owns_client = http_client is None

    def with_api_key(self, api_key: SecretStr) -> "OpenAICompatibleProvider":
        """Return a request-scoped credential view that shares the existing HTTP client."""
        return OpenAICompatibleProvider(
            base_url=self.base_url,
            api_key=api_key,
            model=self.model,
            transcription_model=self.transcription_model,
            timeout_seconds=self.timeout_seconds,
            max_timeout_seconds=self.max_timeout_seconds,
            model_profile=self.model_profile,
            long_context_model=self.long_context_model,
            http_client=self._client_or_create(),
        )

    def capabilities(self) -> ProviderCapabilities:
        available = [
            ProviderCapability.structured_text,
            ProviderCapability.multimodal_image,
            ProviderCapability.multimodal_frames,
            ProviderCapability.long_context,
        ]
        notes: list[str] = []
        if self.transcription_model:
            available.append(ProviderCapability.transcription)
        else:
            notes.append('No transcription model is configured, so audio is analysed without a transcript.')
        if not self.long_context_model:
            notes.append('Long-context requests use the default model.')
        return ProviderCapabilities(
            provider='openai_compatible', capabilities=available, model_profile=self.model_profile,
            max_timeout_seconds=self.max_timeout_seconds, max_context_tokens=0, notes=notes,
        )

    def _client_or_create(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.max_timeout_seconds, follow_redirects=False)
        return self._client

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    def _headers(self) -> dict[str, str]:
        return {'Authorization': f'Bearer {self.api_key.get_secret_value()}', 'Content-Type': 'application/json'}

    def _model_for(self, request: GenerationRequest) -> str:
        if request.long_context and self.long_context_model:
            return self.long_context_model
        return self.model

    def _messages(self, request: GenerationRequest) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        if request.system:
            messages.append({'role': 'system', 'content': request.system})
        content: list[dict[str, Any]] = [{'type': 'text', 'text': request.prompt}]
        for image in request.images:
            label = image.label or ('frame' if image.kind == 'frame' else 'reference image')
            timecode = f' at {image.timecode_ms} ms' if image.timecode_ms is not None else ''
            content.append({'type': 'text', 'text': f'[{label}{timecode}]'})
            content.append({'type': 'image_url', 'image_url': {'url': f'data:{image.media_type};base64,{image.data_base64}'}})
        if request.repair_feedback:
            content.append({
                'type': 'text',
                'text': 'Your previous answer could not be validated. Return JSON that satisfies the schema exactly. Validation problem: ' + request.repair_feedback,
            })
        messages.append({'role': 'user', 'content': content})
        return messages

    async def generate(self, request: GenerationRequest) -> GenerationResult:
        model = self._model_for(request)
        payload: dict[str, Any] = {
            'model': model,
            'messages': self._messages(request),
            'max_tokens': request.max_output_tokens,
        }
        if request.response_schema:
            payload['response_format'] = {
                'type': 'json_schema',
                'json_schema': {'name': request.schema_name, 'strict': True, 'schema': request.response_schema},
            }
        else:
            payload['response_format'] = {'type': 'json_object'}
        timeout = min(max(request.timeout_seconds, 1.0), self.max_timeout_seconds)
        started = time.perf_counter()
        try:
            response = await self._client_or_create().post(
                f'{self.base_url}/chat/completions', headers=self._headers(), json=payload, timeout=timeout,
            )
        except httpx.TimeoutException as exc:
            raise ProviderFailed('The AI provider did not answer in time.', retryable=True) from exc
        except httpx.HTTPError as exc:
            raise ProviderFailed('The AI provider could not be reached.', retryable=True) from exc
        if response.status_code in (408, 409, 425, 429) or response.status_code >= 500:
            raise ProviderFailed(f'The AI provider returned status {response.status_code}.', retryable=True)
        if response.status_code >= 400:
            raise ProviderFailed(f'The AI provider rejected the request with status {response.status_code}.', retryable=False)
        try:
            body = response.json()
            choice = body['choices'][0]
            content = choice['message']['content']
            usage = body.get('usage') or {}
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise ProviderMalformedOutput('The AI provider returned an unrecognised response envelope.') from exc
        if isinstance(content, list):
            content = ''.join(part.get('text', '') for part in content if isinstance(part, dict))
        if not isinstance(content, str) or not content.strip():
            raise ProviderMalformedOutput('The AI provider returned an empty structured answer.')
        try:
            parsed = json.loads(content)
        except ValueError as exc:
            raise ProviderMalformedOutput('The AI provider returned text that is not valid JSON.') from exc
        if not isinstance(parsed, dict):
            raise ProviderMalformedOutput('The AI provider returned structured output that is not an object.')
        return GenerationResult(
            output=parsed, provider='openai_compatible', model=model,
            input_tokens=int(usage.get('prompt_tokens') or 0), output_tokens=int(usage.get('completion_tokens') or 0),
            attempts=request.repair_attempt + 1, repaired=request.repair_attempt > 0,
            latency_ms=round((time.perf_counter() - started) * 1000),
        )

    async def transcribe(self, request: TranscriptionRequest) -> TranscriptionResult:
        if not self.transcription_model:
            raise ProviderFailed('No transcription model is configured for this provider.', retryable=False)
        timeout = min(max(request.timeout_seconds, 1.0), self.max_timeout_seconds)
        data: dict[str, str] = {'model': self.transcription_model, 'response_format': 'verbose_json'}
        if request.language:
            data['language'] = request.language
        files = {'file': (request.filename, request.data, request.media_type)}
        try:
            response = await self._client_or_create().post(
                f'{self.base_url}/audio/transcriptions',
                headers={'Authorization': f'Bearer {self.api_key.get_secret_value()}'},
                data=data, files=files, timeout=timeout,
            )
        except httpx.TimeoutException as exc:
            raise ProviderFailed('Transcription timed out.', retryable=True) from exc
        except httpx.HTTPError as exc:
            raise ProviderFailed('The transcription endpoint could not be reached.', retryable=True) from exc
        if response.status_code >= 400:
            raise ProviderFailed(f'Transcription failed with status {response.status_code}.', retryable=response.status_code >= 500 or response.status_code == 429)
        try:
            body = response.json()
        except ValueError as exc:
            raise ProviderMalformedOutput('The transcription endpoint returned an invalid response.') from exc
        raw_segments = body.get('segments') or []
        segments: list[TranscriptSegment] = []
        for index, segment in enumerate(raw_segments):
            if not isinstance(segment, dict):
                continue
            start = segment.get('start')
            end = segment.get('end')
            if start is None or end is None:
                continue
            segments.append(TranscriptSegment(
                index=index, start_ms=int(round(float(start) * 1000)), end_ms=int(round(float(end) * 1000)),
                text=str(segment.get('text') or '').strip()[:4000],
                speaker=str(segment['speaker'])[:80] if segment.get('speaker') is not None else None,
            ))
        duration = body.get('duration')
        return TranscriptionResult(
            text=str(body.get('text') or '').strip()[:200_000], segments=segments,
            language=str(body['language'])[:12] if body.get('language') else request.language,
            provider='openai_compatible', model=self.transcription_model,
            duration_ms=int(round(float(duration) * 1000)) if duration is not None else None,
            speaker_segmentation=any(segment.speaker for segment in segments),
        )
