from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import health, sodex, sosovalue
from .core.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="vega-backend",
        version="0.1.0",
        description="Agentic on-chain finance backend powered by SoSoValue + SoDEX.",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=True,
    )

    app.include_router(health.router)
    app.include_router(sosovalue.router, prefix="/v1")
    app.include_router(sodex.router, prefix="/v1")

    return app


app = create_app()
