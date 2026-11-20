"""Traces and structured logs in the ML service (A5).

Done when: a request carrying the API's ``traceparent`` is a span in that
trace, named by route; spans encode as the OTLP JSON a collector reads;
log lines are JSON naming the trace they were written in; and a collector
URL that is not http(s) stops the service.
"""

from __future__ import annotations

import importlib
import json
import logging

import pytest
from fastapi.testclient import TestClient
from opentelemetry import trace
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from robis_ml import auth, telemetry

TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
PARENT_ID = "00f067aa0ba902b7"


@pytest.fixture(scope="module")
def exporter() -> InMemorySpanExporter:
    """One provider for the module: OpenTelemetry sets it once per process."""
    kept = InMemorySpanExporter()
    telemetry.start_tracing(SimpleSpanProcessor(kept))
    return kept


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, exporter: InMemorySpanExporter) -> TestClient:
    monkeypatch.setenv(auth.TOKEN_ENV, "test-service-token")
    service = importlib.reload(importlib.import_module("robis_ml.service"))
    exporter.clear()
    return TestClient(service.app)


def test_a_request_continues_the_callers_trace(
    client: TestClient, exporter: InMemorySpanExporter
) -> None:
    client.get(
        "/health",
        headers={"traceparent": f"00-{TRACE_ID}-{PARENT_ID}-01", "x-request-id": "req-7"},
    )
    [span] = [s for s in exporter.get_finished_spans() if s.kind.name == "SERVER"]
    assert format(span.context.trace_id, "032x") == TRACE_ID
    assert format(span.parent.span_id, "016x") == PARENT_ID
    assert span.name == "GET /health"
    assert span.attributes["robis.request_id"] == "req-7"
    assert span.attributes["http.response.status_code"] == 200


def test_a_route_with_ids_is_named_by_its_pattern(
    client: TestClient, exporter: InMemorySpanExporter
) -> None:
    client.post(
        "/workspaces/not-a-uuid/suggestions",
        headers={"Authorization": "Bearer test-service-token"},
        json={"title": "x"},
    )
    [span] = [s for s in exporter.get_finished_spans() if s.kind.name == "SERVER"]
    assert "not-a-uuid" not in span.name
    assert span.name == "POST /workspaces/{workspace_id}/suggestions"


def test_spans_encode_as_otlp_json(exporter: InMemorySpanExporter) -> None:
    exporter.clear()
    tracer = trace.get_tracer("test")
    with tracer.start_as_current_span("outer"), tracer.start_as_current_span("inner") as inner:
        inner.set_attribute("robis.count", 3)
    spans = exporter.get_finished_spans()
    body = telemetry.otlp_json(spans)
    [resource] = body["resourceSpans"]
    encoded = resource["scopeSpans"][0]["spans"]
    by_name = {span["name"]: span for span in encoded}
    assert len(by_name["inner"]["traceId"]) == 32
    assert by_name["inner"]["parentSpanId"] == by_name["outer"]["spanId"]
    assert "parentSpanId" not in by_name["outer"]
    assert by_name["inner"]["kind"] == 1
    assert {"key": "robis.count", "value": {"intValue": "3"}} in by_name["inner"]["attributes"]
    assert resource["resource"]["attributes"] == [
        {"key": "service.name", "value": {"stringValue": "ml"}}
    ]
    json.dumps(body)


def test_log_lines_are_json_naming_their_trace(exporter: InMemorySpanExporter) -> None:
    formatter = telemetry.JsonLines()
    record = logging.LogRecord("robis_ml", logging.WARNING, __file__, 1, "slow fit", None, None)
    outside = json.loads(formatter.format(record))
    assert outside["level"] == "warn"
    assert outside["service"] == "ml"
    assert "traceId" not in outside

    with trace.get_tracer("test").start_as_current_span("fit") as span:
        inside = json.loads(formatter.format(record))
    assert inside["traceId"] == format(span.get_span_context().trace_id, "032x")


def test_an_error_is_logged_by_name_message_and_stack() -> None:
    try:
        raise ValueError("no corpus")
    except ValueError:
        import sys

        record = logging.LogRecord(
            "robis_ml", logging.ERROR, __file__, 1, "fit failed", None, sys.exc_info()
        )
    line = json.loads(telemetry.JsonLines().format(record))
    assert line["err"]["name"] == "ValueError"
    assert line["err"]["message"] == "no corpus"
    assert "Traceback" in line["err"]["stack"]


def test_a_collector_url_that_is_not_http_stops_the_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "collector:4318")
    with pytest.raises(RuntimeError, match="not an http"):
        telemetry.start_tracing()
