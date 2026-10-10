"""Vercel Python Functions entrypoint for the existing TONDE FastAPI service.

The Vercel runtime imports this module from the backend service root. Durable jobs
remain in Supabase; this request-serving process must never start the continuous
worker loop because Vercel Functions do not provide a persistent worker process.
"""

from app.core.config import get_settings
from app.main import create_app


base_settings = get_settings()
vercel_settings = base_settings.model_copy(update={"worker_enabled": False})
app = create_app(settings=vercel_settings)

__all__ = ["app"]
