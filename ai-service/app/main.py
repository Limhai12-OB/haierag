"""HaieRag AI service entrypoint."""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api import health, internal
from app.container import Container
from app.core.config import get_settings
from app.core.errors import HaieRagError
from app.core.logging import configure_logging

log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)
    container = Container.build(settings)
    await container.start(run_worker=settings.ingest_worker_enabled)
    app.state.container = container
    log.info("ai-service started", extra={"llm": settings.llm_model, "embedding": settings.embedding_model,
                                          "reranker": settings.reranker_model if settings.reranker_enabled else None})
    try:
        yield
    finally:
        await container.close()


def create_app() -> FastAPI:
    app = FastAPI(title="HaieRag AI Service", version="0.1.0", lifespan=lifespan,
                  docs_url="/docs" if get_settings().app_env != "production" else None)
    app.include_router(health.router)
    app.include_router(internal.router)

    @app.exception_handler(HaieRagError)
    async def _domain_error(_: Request, exc: HaieRagError):
        return JSONResponse(status_code=exc.status_code,
                            content={"type": "about:blank", "title": exc.code, "code": exc.code, "status": exc.status_code,
                                     "detail": exc.message},
                            media_type="application/problem+json")

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        return JSONResponse(status_code=400,
                            content={"type": "about:blank", "title": "Validation failed", "status": 400,
                                     "errors": [{"loc": e["loc"], "msg": e["msg"]} for e in exc.errors()]},
                            media_type="application/problem+json")

    @app.middleware("http")
    async def _access_log(request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        if request.url.path != "/health/live":
            log.info("request", extra={"method": request.method, "path": request.url.path,
                                       "status": response.status_code,
                                       "ms": round((time.perf_counter() - start) * 1000, 1)})
        return response

    return app


app = create_app()
