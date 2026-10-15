from fastapi import Request
from pydantic import SecretStr

from app.services.ai.openai_compatible import OpenAICompatibleProvider
from app.services.ai.provider import DirectorModelProvider
from app.services.media.frames import FrameExtractor


def get_ai_provider(request: Request) -> DirectorModelProvider:
    provider: DirectorModelProvider = request.app.state.ai_provider
    # Vercel supplies the project OIDC token on each Function request rather than
    # as a stable runtime environment variable. When TONDE is routed through
    # Vercel AI Gateway, use that request-scoped credential instead of the
    # deployment's direct-provider API key. The cloned provider reuses the
    # long-lived HTTP client owned by the application provider.
    oidc_token = request.headers.get('x-vercel-oidc-token')
    if (
        oidc_token
        and isinstance(provider, OpenAICompatibleProvider)
        and provider.base_url.startswith('https://ai-gateway.vercel.sh')
    ):
        return provider.with_api_key(SecretStr(oidc_token))
    return provider


def get_frame_extractor(request: Request) -> FrameExtractor:
    extractor: FrameExtractor = request.app.state.frame_extractor
    return extractor
