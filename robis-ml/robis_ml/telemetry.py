"""Traces and structured logs for the ML service (A5).

The API sends the W3C ``traceparent`` of the request that asked for
suggestions; this service continues that trace with a span per request,
named by route and carrying the request id, and writes its log lines as
JSON with the trace and span they were written in, the same shape as the
other services' lines.

Spans leave the process only when ``OTEL_EXPORTER_OTLP_ENDPOINT`` names a
collector, sent as OTLP/HTTP JSON by the small exporter below, so the
service needs the OpenTelemetry SDK (Apache-2.0) and nothing heavier: the
SDK's own OTLP exporters bring protobuf and gRPC. FastAPI opens the request
spans itself (its own telemetry, with its environment export turned off,
since this module exports). Spans hold routes, ids and status codes, never
an issue's words.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import urllib.request
from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, datetime

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    SpanExporter,
    SpanExportResult,
    SpanProcessor,
)
from starlette.requests import Request
from starlette.responses import Response

SERVICE = "ml"
_EXPORT_TIMEOUT_SECONDS = 5
_access = logging.getLogger("robis_ml.access")


def _attribute(key: str, value: object) -> dict[str, object]:
    if isinstance(value, bool):
        return {"key": key, "value": {"boolValue": value}}
    if isinstance(value, int):
        return {"key": key, "value": {"intValue": str(value)}}
    if isinstance(value, float):
        return {"key": key, "value": {"doubleValue": value}}
    return {"key": key, "value": {"stringValue": str(value)}}


def otlp_json(spans: Sequence[ReadableSpan]) -> dict[str, object]:
    """Spans as the OTLP/HTTP JSON body a collector accepts at /v1/traces."""
    encoded = []
    for span in spans:
        ids = span.context
        parent = span.parent
        encoded.append(
            {
                "traceId": format(ids.trace_id, "032x"),
                "spanId": format(ids.span_id, "016x"),
                **({"parentSpanId": format(parent.span_id, "016x")} if parent else {}),
                "name": span.name,
                # OTLP numbers kinds from 1 (internal); the SDK's enum from 0.
                "kind": span.kind.value + 1,
                "startTimeUnixNano": str(span.start_time or 0),
                "endTimeUnixNano": str(span.end_time or 0),
                "attributes": [_attribute(k, v) for k, v in (span.attributes or {}).items()],
                "status": {"code": span.status.status_code.value},
            }
        )
    return {
        "resourceSpans": [
            {
                "resource": {"attributes": [_attribute("service.name", SERVICE)]},
                "scopeSpans": [{"scope": {"name": "robis-ml"}, "spans": encoded}],
            }
        ]
    }


class OtlpJsonExporter(SpanExporter):
    """Posts finished spans to a collector as OTLP/HTTP JSON."""

    def __init__(self, endpoint: str) -> None:
        self._url = f"{endpoint.rstrip('/')}/v1/traces"

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        body = json.dumps(otlp_json(spans)).encode()
        request = urllib.request.Request(
            self._url, data=body, headers={"content-type": "application/json"}, method="POST"
        )
        try:
            with urllib.request.urlopen(request, timeout=_EXPORT_TIMEOUT_SECONDS):
                return SpanExportResult.SUCCESS
        except OSError:
            return SpanExportResult.FAILURE

    def shutdown(self) -> None:
        return None


def start_tracing(processor: SpanProcessor | None = None) -> bool:
    """Trace if a collector is named (or a test hands in a processor)."""
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if processor is None and endpoint:
        if not endpoint.startswith(("http://", "https://")):
            raise RuntimeError(f"OTEL_EXPORTER_OTLP_ENDPOINT is not an http(s) URL: {endpoint}")
        processor = BatchSpanProcessor(OtlpJsonExporter(endpoint))
    if processor is None:
        return False
    provider = TracerProvider(resource=Resource.create({"service.name": SERVICE}))
    provider.add_span_processor(processor)
    trace.set_tracer_provider(provider)
    return True


async def trace_requests(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Mark FastAPI's request span with the request id, and log the request in it.

    FastAPI opens the server span itself, continuing the caller's
    ``traceparent`` and named by the route's pattern; this adds the id the
    API's lines share, and writes the access line inside the span.
    """
    response = await call_next(request)
    span = trace.get_current_span()
    request_id = request.headers.get("x-request-id", "")
    if request_id:
        span.set_attribute("robis.request_id", request_id)
    route = getattr(request.scope.get("route"), "path", "") or ""
    # uvicorn's own access line is turned off (see the ML Dockerfile).
    _access.info(
        "request completed",
        extra={"fields": {"reqId": request_id, "route": route, "statusCode": response.status_code}},
    )
    return response


class JsonLines(logging.Formatter):
    """A log record as one JSON object, in the other services' shape."""

    def format(self, record: logging.LogRecord) -> str:
        span = trace.get_current_span().get_span_context()
        line: dict[str, object] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname.lower().replace("warning", "warn"),
            "service": SERVICE,
            "msg": record.getMessage(),
        }
        if span.is_valid:
            line["traceId"] = format(span.trace_id, "032x")
            line["spanId"] = format(span.span_id, "016x")
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            line.update(fields)
        if record.exc_info and record.exc_info[1] is not None:
            error = record.exc_info[1]
            line["err"] = {
                "name": type(error).__name__,
                "message": str(error),
                "stack": self.formatException(record.exc_info),
            }
        return json.dumps(line)


def json_logging() -> None:
    """Send this service's log lines to stderr as JSON."""
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonLines())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
