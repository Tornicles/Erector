from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


def setup_cors(app: FastAPI, origins: list[str]) -> None:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=['GET', 'POST', 'PATCH', 'OPTIONS'],
        allow_headers=['Authorization', 'Content-Type', 'X-Request-ID'],
        expose_headers=['X-Request-ID', 'X-Process-Time-Ms'],
    )
