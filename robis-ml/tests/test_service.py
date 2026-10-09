"""Tests for the HTTP surface.

Two properties matter here and neither was covered before: that the
endpoints are closed without a token, and that one workspace's issues can
never reach another workspace's answer. The second was asserted only in
comments, which is not an assertion.

`load_issues` is monkeypatched, so none of this needs a database. That is
the point of keeping the loader in its own module.
"""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient

from robis_ml import auth, model

TOKEN = "test-service-token"

ALPHA = "11111111-1111-4111-8111-111111111111"
BETA = "22222222-2222-4222-8222-222222222222"

CORPORA = {
    ALPHA: [
        model.Issue("a1", "Offline queue drops writes", "IndexedDB mutations are lost"),
        model.Issue("a2", "Alpha only secret", "nothing to do with beta"),
    ],
    BETA: [
        model.Issue("b1", "Billing page is blank", "the invoice list does not render"),
    ],
}


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    """A client over a freshly imported service with a known token."""
    monkeypatch.setenv(auth.TOKEN_ENV, TOKEN)
    monkeypatch.delenv(auth.ALLOW_ANONYMOUS_ENV, raising=False)

    # Reimported so `check_configuration` runs against the patched
    # environment and the per-workspace cache starts empty.
    service = importlib.reload(importlib.import_module("robis_ml.service"))
    monkeypatch.setattr(service, "load_issues", lambda workspace_id: CORPORA[workspace_id])
    monkeypatch.setattr(
        service,
        "corpus_fingerprint",
        lambda workspace_id: (len(CORPORA[workspace_id]), "2026-01-01T00:00:00+00:00"),
    )

    return TestClient(service.app)


def auth_header(token: str = TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class TestAuthentication:
    def test_health_needs_no_token(self, client: TestClient) -> None:
        # A liveness probe reports nothing about any workspace, so it stays
        # open for whatever is watching the process.
        assert client.get("/health").status_code == 200

    @pytest.mark.parametrize("path", ["similar", "triage"])
    def test_tenant_endpoints_refuse_without_a_token(
        self, client: TestClient, path: str
    ) -> None:
        response = client.post(f"/workspaces/{ALPHA}/{path}", json={"title": "anything"})

        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"

    @pytest.mark.parametrize(
        "header",
        [
            {"Authorization": "Bearer wrong-token"},
            {"Authorization": TOKEN},  # right secret, missing scheme
            {"Authorization": "Basic " + TOKEN},
            {"Authorization": "Bearer "},
        ],
    )
    def test_a_malformed_or_wrong_credential_is_refused(
        self, client: TestClient, header: dict[str, str]
    ) -> None:
        response = client.post(
            f"/workspaces/{ALPHA}/similar", json={"title": "anything"}, headers=header
        )

        assert response.status_code == 401

    def test_the_right_token_is_accepted(self, client: TestClient) -> None:
        response = client.post(
            f"/workspaces/{ALPHA}/similar", json={"title": "anything"}, headers=auth_header()
        )

        assert response.status_code == 200

    def test_anonymous_mode_opens_the_endpoints(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv(auth.TOKEN_ENV, raising=False)
        monkeypatch.setenv(auth.ALLOW_ANONYMOUS_ENV, "1")

        service = importlib.reload(importlib.import_module("robis_ml.service"))
        monkeypatch.setattr(service, "load_issues", lambda workspace_id: CORPORA[workspace_id])
        monkeypatch.setattr(service, "corpus_fingerprint", lambda workspace_id: (1, "x"))

        response = TestClient(service.app).post(
            f"/workspaces/{ALPHA}/similar", json={"title": "anything"}
        )

        assert response.status_code == 200

    def test_importing_unconfigured_refuses_rather_than_serving_openly(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv(auth.TOKEN_ENV, raising=False)
        monkeypatch.delenv(auth.ALLOW_ANONYMOUS_ENV, raising=False)

        with pytest.raises(RuntimeError, match="Refusing to start"):
            importlib.reload(importlib.import_module("robis_ml.service"))


class TestTenantIsolation:
    def test_a_query_only_ever_returns_its_own_workspaces_issues(
        self, client: TestClient
    ) -> None:
        """The property the whole design rests on.

        Alpha's corpus contains a near-duplicate of the query; Beta's does
        not contain anything like it. Asking Beta must not surface Alpha's
        row however similar it is.
        """
        query = {"title": "Offline writes in the queue get lost"}

        alpha = client.post(
            f"/workspaces/{ALPHA}/similar?threshold=0.05", json=query, headers=auth_header()
        ).json()
        beta = client.post(
            f"/workspaces/{BETA}/similar?threshold=0.05", json=query, headers=auth_header()
        ).json()

        assert {m["id"] for m in alpha["similar"]} <= {"a1", "a2"}
        assert "a1" in {m["id"] for m in alpha["similar"]}

        # Beta's only issue is about billing, so nothing should clear the bar,
        # and Alpha's rows must not appear whatever happens.
        assert {m["id"] for m in beta["similar"]} <= {"b1"}
        assert beta["corpus_size"] == 1

    def test_the_cache_does_not_serve_one_workspace_from_another(
        self, client: TestClient
    ) -> None:
        # Warming Alpha first is the interesting order: a cache keyed wrongly
        # would hand Alpha's fitted model back for Beta.
        client.post(f"/workspaces/{ALPHA}/similar", json={"title": "warm"}, headers=auth_header())

        beta = client.post(
            f"/workspaces/{BETA}/similar", json={"title": "warm"}, headers=auth_header()
        ).json()

        assert beta["corpus_size"] == 1


class TestRequestValidation:
    def test_a_malformed_workspace_id_is_rejected_before_the_database(
        self, client: TestClient
    ) -> None:
        response = client.post(
            "/workspaces/not-a-uuid/similar", json={"title": "x"}, headers=auth_header()
        )

        # 422, not the 500 a failed `::uuid` cast used to produce.
        assert response.status_code == 422

    def test_a_threshold_outside_zero_to_one_is_rejected(self, client: TestClient) -> None:
        response = client.post(
            f"/workspaces/{ALPHA}/similar?threshold=5",
            json={"title": "x"},
            headers=auth_header(),
        )

        assert response.status_code == 400

    def test_triage_declines_on_a_small_corpus_and_says_why(self, client: TestClient) -> None:
        response = client.post(
            f"/workspaces/{ALPHA}/triage", json={"title": "x"}, headers=auth_header()
        ).json()

        assert response["priority"] is None
        assert response["score"] is None
        assert str(model.MIN_TRAINING_EXAMPLES) in response["reason"]

    def test_triage_reports_how_many_labelled_issues_it_needs(self, client: TestClient) -> None:
        # The API turns a refusal into "suggestions start at 40 triaged issues
        # (9 so far)". It reads the minimum from here rather than keeping its
        # own copy that could drift from the model's.
        response = client.post(
            f"/workspaces/{ALPHA}/triage", json={"title": "x"}, headers=auth_header()
        ).json()

        assert response["needed"] == model.MIN_TRAINING_EXAMPLES
        assert response["trained_on"] < response["needed"]


class TestCacheInvalidation:
    """The staleness bug: a just-filed issue must be findable immediately."""

    def test_a_new_issue_invalidates_the_cached_model(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(auth.TOKEN_ENV, TOKEN)
        service = importlib.reload(importlib.import_module("robis_ml.service"))

        corpus = [model.Issue("a1", "Billing page is blank", "")]
        fingerprint = [(1, "t1")]

        monkeypatch.setattr(service, "load_issues", lambda _: list(corpus))
        monkeypatch.setattr(service, "corpus_fingerprint", lambda _: fingerprint[0])

        client = TestClient(service.app)
        query = {"title": "Offline queue drops writes"}

        first = client.post(
            f"/workspaces/{ALPHA}/similar?threshold=0.05", json=query, headers=auth_header()
        ).json()
        assert first["corpus_size"] == 1

        # Somebody files the issue the query is about.
        corpus.append(model.Issue("a2", "Offline queue drops writes", "mutations are lost"))
        fingerprint[0] = (2, "t2")

        second = client.post(
            f"/workspaces/{ALPHA}/similar?threshold=0.05", json=query, headers=auth_header()
        ).json()

        # Under the old five-minute TTL this was still 1 for five minutes.
        assert second["corpus_size"] == 2
        assert "a2" in {m["id"] for m in second["similar"]}

    def test_an_unchanged_workspace_reuses_the_cached_model(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(auth.TOKEN_ENV, TOKEN)
        service = importlib.reload(importlib.import_module("robis_ml.service"))

        fits = {"count": 0}

        def counting_loader(workspace_id: str):
            fits["count"] += 1
            return CORPORA[workspace_id]

        monkeypatch.setattr(service, "load_issues", counting_loader)
        monkeypatch.setattr(service, "corpus_fingerprint", lambda _: (2, "stable"))

        client = TestClient(service.app)
        for _ in range(3):
            client.post(
                f"/workspaces/{ALPHA}/similar", json={"title": "x"}, headers=auth_header()
            )

        # A fingerprint check per request, but only one load and fit.
        assert fits["count"] == 1

    def test_an_unreachable_database_serves_the_model_in_hand(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(auth.TOKEN_ENV, TOKEN)
        service = importlib.reload(importlib.import_module("robis_ml.service"))

        monkeypatch.setattr(service, "load_issues", lambda w: CORPORA[w])
        monkeypatch.setattr(service, "corpus_fingerprint", lambda _: (2, "ok"))

        client = TestClient(service.app)
        client.post(f"/workspaces/{ALPHA}/similar", json={"title": "x"}, headers=auth_header())

        def broken(_: str):
            raise RuntimeError("connection refused")

        monkeypatch.setattr(service, "corpus_fingerprint", broken)

        # Failing to check freshness is not grounds to fail the request, or
        # to throw away a working model.
        response = client.post(
            f"/workspaces/{ALPHA}/similar", json={"title": "x"}, headers=auth_header()
        )

        assert response.status_code == 200
        assert response.json()["corpus_size"] == 2
