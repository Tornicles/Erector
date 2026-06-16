"""
Erector — Supervisor Entry Point (Prompt A1+)

Supervisor runs this file as `server:app` on port 8001.
All application logic lives in app/main.py.
This shim re-exports the FastAPI `app` instance from there.
"""

# Verify schema integrity on import (Prompt 0 contract)
from models import *  # noqa: F401, F403

# Re-export the A1 application as `app` so supervisor can find it
from app.main import app  # noqa: F401
