"""Portable TONDE services entry point: uvicorn server:app."""
from app.main import app

__all__ = ['app']
