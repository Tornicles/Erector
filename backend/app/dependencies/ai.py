from fastapi import Request

from app.services.ai.provider import DirectorModelProvider
from app.services.media.frames import FrameExtractor


def get_ai_provider(request: Request) -> DirectorModelProvider:
    provider: DirectorModelProvider = request.app.state.ai_provider
    return provider


def get_frame_extractor(request: Request) -> FrameExtractor:
    extractor: FrameExtractor = request.app.state.frame_extractor
    return extractor
