import logging
import re
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes.data import router as data_router
from app.core.config import get_settings
from app.core.logging_config import configure_logging

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.api_title, version=settings.api_version)

allow_all_origins = "*" in settings.cors_origin_list

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all_origins else settings.cors_origin_list,
    allow_credentials=not allow_all_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pattern to match NaN / nan / Infinity / -Infinity optionally enclosed in quotes.
_NAN_INF_RE = re.compile(r'"?(?:\bnan\b|-?\binf(?:inity)?\b)"?', re.IGNORECASE)


@app.middleware("http")
async def sanitize_nan_middleware(request: Request, call_next):
    """Replace nan / Infinity literals in JSON bodies with null so the
    standard JSON parser can handle payloads from ESP devices."""
    if (
        request.method in ("POST", "PUT", "PATCH")
        and "application/json" in (request.headers.get("content-type") or "")
    ):
        raw_body = await request.body()
        body_text = raw_body.decode("utf-8", errors="replace")
        if _NAN_INF_RE.search(body_text):
            sanitized_bytes = _NAN_INF_RE.sub("null", body_text).encode("utf-8")
            logger.warning(
                "Sanitized NaN/Inf in request body for %s: %s -> %s",
                request.url.path,
                body_text[:200],
                sanitized_bytes.decode()[:200],
            )

            async def receive():
                return {"type": "http.request", "body": sanitized_bytes}

            request._receive = receive
            # Clear the cached body so Starlette re-reads via our patched _receive
            request._body = sanitized_bytes

    return await call_next(request)


@app.middleware("http")
async def request_timing_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    process_time_ms = (time.perf_counter() - start) * 1000
    logger.info("%s %s -> %s (%.2f ms)", request.method, request.url.path, response.status_code, process_time_ms)
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error for %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/health")
def health_check():
    return {"status": "ok"}


app.include_router(data_router)
