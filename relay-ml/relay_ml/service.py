"""HTTP surface for the two models.

    uvicorn relay_ml.service:app --port 8000

A separate process from the Fastify API rather than a library inside it,
because the two have different shapes: scikit-learn is synchronous and
CPU-bound, and fitting a model inside the event loop that serves issue
reads would stall every request for the duration.

Everything here is *advisory*. These endpoints suggest; they never decide.
Nothing in Relay changes a priority or closes an issue on the strength of a
prediction, and the response always carries the score so the caller can
disagree with it.

Not currently wired into the API. It is deployed and called separately, and
saying so is better than implying an integration that does not exist.
"""

from __future__ import annotations

import logging
from collections import OrderedDict, defaultdict
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from .auth import check_configuration, require_service_token
from .data import load_issues
from .model import (
    DEFAULT_DUPLICATE_THRESHOLD,
    MIN_TRAINING_EXAMPLES,
    DuplicateFinder,
    TriageModel,
    compose_text,
)

logger = logging.getLogger(__name__)

#: How long a fitted workspace is reused before the next request refits.
#:
#: This is a staleness window, and it is the weakest thing about the
#: service: there is no invalidation, so an issue filed now is invisible to
#: duplicate detection for up to this long. That is exactly the wrong moment
#: to be blind, because the author who just filed it is the person most
#: likely to file it twice.
#:
#: Every response carries `model_age_seconds` so a caller can see how stale
#: the answer is rather than having to assume. The real fix is an
#: invalidation hook, or checking `max(updated_at)` per workspace before
#: reusing a model; both are on the roadmap, neither is done.
CACHE_TTL_SECONDS = 300

# Before the app exists, so an unconfigured deployment dies at import rather
# than serving one unauthenticated request.
check_configuration()

app = FastAPI(
    title="Relay ML",
    summary="Duplicate detection and priority triage for Relay issues.",
    version="0.1.0",
)


@dataclass
class Fitted:
    duplicates: DuplicateFinder
    triage: TriageModel
    issue_count: int
    fitted_at: float


# Per-workspace, because the models are per-tenant: issues from one
# workspace must never inform a suggestion shown in another.
#
# Bounded, and evicted oldest-first. Without a cap this grows by one TF-IDF
# matrix per distinct workspace id ever seen, and since the id comes
# straight off the URL the key space is whatever a caller sends.
_cache: OrderedDict[str, Fitted] = OrderedDict()
MAX_CACHED_WORKSPACES = 64

# One lock for the cache dictionary, held only long enough to read or write
# it. An earlier version held a single global lock across `_fit`, which
# includes a round trip to Postgres: every request for every workspace,
# cache hits included, queued behind any one refit, and a slow database
# stalled the whole service.
_cache_lock = Lock()

# One lock per workspace, so two concurrent cold requests for the same
# workspace fit once rather than racing. Different workspaces fit in
# parallel; separate estimator objects do not share state.
_fit_locks: defaultdict[str, Lock] = defaultdict(Lock)


def _fit(workspace_id: str) -> Fitted:
    issues = load_issues(workspace_id)

    triage = TriageModel()
    trained = triage.fit(issues)

    logger.info(
        "fitted workspace=%s issues=%d triage=%s",
        workspace_id,
        len(issues),
        "ready" if trained else "declined",
    )

    return Fitted(
        duplicates=DuplicateFinder(issues),
        triage=triage,
        issue_count=len(issues),
        fitted_at=monotonic(),
    )


def _cached(workspace_id: str) -> Fitted | None:
    with _cache_lock:
        found = _cache.get(workspace_id)
        if found is None or monotonic() - found.fitted_at >= CACHE_TTL_SECONDS:
            return None

        _cache.move_to_end(workspace_id)
        return found


def _store(workspace_id: str, fitted: Fitted) -> None:
    with _cache_lock:
        _cache[workspace_id] = fitted
        _cache.move_to_end(workspace_id)

        while len(_cache) > MAX_CACHED_WORKSPACES:
            _cache.popitem(last=False)


def _models_for(workspace_id: str) -> Fitted:
    hit = _cached(workspace_id)
    if hit is not None:
        return hit

    # The per-workspace lock is taken around the fit, and the cache lock is
    # not held across it. The second check inside the lock is the
    # single-flight: whoever lost the race finds the winner's model here
    # rather than fitting the same thing again.
    with _fit_locks[workspace_id]:
        hit = _cached(workspace_id)
        if hit is not None:
            return hit

        fitted = _fit(workspace_id)
        _store(workspace_id, fitted)
        return fitted


class TextRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=20_000)
    #: Set when checking an existing issue, so it is not returned as its own
    #: duplicate.
    exclude_id: str | None = None

    @property
    def text(self) -> str:
        # The same function the corpus goes through, not a copy of it. Two
        # implementations that happen to agree is a train/serve skew bug
        # waiting for somebody to edit one of them.
        return compose_text(self.title, self.description)


class SimilarIssue(BaseModel):
    id: str
    title: str
    score: float


class SimilarResponse(BaseModel):
    similar: list[SimilarIssue]
    corpus_size: int
    #: How long ago this workspace's model was fitted. Non-zero means the
    #: answer may not reflect very recently filed issues.
    model_age_seconds: int


class TriageResponse(BaseModel):
    #: None when the model declined to fit. The caller shows nothing rather
    #: than a guess.
    priority: str | None
    #: The model's probability for that label, and deliberately *not* called
    #: "confidence". It is an uncalibrated softmax from a regularised
    #: logistic regression trained with `class_weight="balanced"`, which
    #: shifts probabilities away from the real class priors on purpose.
    #: Nothing here measures calibration, so treat it as a ranking signal,
    #: not as "we are 87% sure".
    score: float | None
    #: Why there is no prediction, when there is none.
    reason: str | None = None
    trained_on: int
    model_age_seconds: int


def _valid_workspace(workspace_id: str) -> str:
    """Reject a malformed id here rather than in the SQL cast.

    Postgres raises on `'nonsense'::uuid`, which surfaced as an unhandled
    500 and a stack trace in the log for what is really a bad request.
    """
    try:
        UUID(workspace_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="workspace id must be a UUID") from None

    return workspace_id


@app.get("/health")
def health() -> dict[str, object]:
    # Deliberately does not report the cache size: this is a liveness probe
    # on an unauthenticated port, and the number of workspaces this process
    # has seen is not something to hand out.
    return {"ok": True}


@app.post(
    "/workspaces/{workspace_id}/similar",
    response_model=SimilarResponse,
    dependencies=[Depends(require_service_token)],
)
def similar(
    workspace_id: str,
    request: TextRequest,
    limit: int = 5,
    threshold: float = DEFAULT_DUPLICATE_THRESHOLD,
) -> SimilarResponse:
    """Issues that look like this one.

    Unsupervised, so this works on a workspace with two issues in it. An
    empty list is a real answer, not a failure: most issues are not
    duplicates of anything.
    """
    if not 0.0 <= threshold <= 1.0:
        raise HTTPException(status_code=400, detail="threshold must be between 0 and 1")

    models = _models_for(_valid_workspace(workspace_id))
    matches = models.duplicates.query(
        request.text,
        limit=max(1, min(limit, 25)),
        threshold=threshold,
        exclude_id=request.exclude_id,
    )

    return SimilarResponse(
        similar=[SimilarIssue(id=m.id, title=m.title, score=round(m.score, 4)) for m in matches],
        corpus_size=models.issue_count,
        model_age_seconds=int(monotonic() - models.fitted_at),
    )


@app.post(
    "/workspaces/{workspace_id}/triage",
    response_model=TriageResponse,
    dependencies=[Depends(require_service_token)],
)
def triage(workspace_id: str, request: TextRequest) -> TriageResponse:
    """A suggested priority, or an explicit refusal.

    The refusal is the point. A classifier fitted on a dozen issues will
    still return a label and a confident-looking probability, and that
    number is worse than no answer because it invites someone to trust it.
    """
    models = _models_for(_valid_workspace(workspace_id))
    age = int(monotonic() - models.fitted_at)

    if not models.triage.ready:
        return TriageResponse(
            priority=None,
            score=None,
            reason=(
                f"only {models.triage.trained_on} issues in this workspace carry a real "
                f"priority; at least {MIN_TRAINING_EXAMPLES} are needed before a suggestion "
                "means anything"
            ),
            trained_on=models.triage.trained_on,
            model_age_seconds=age,
        )

    prediction = models.triage.predict(request.text)
    if prediction is None:
        return TriageResponse(
            priority=None,
            score=None,
            reason="model is not fitted",
            trained_on=models.triage.trained_on,
            model_age_seconds=age,
        )

    label, score = prediction

    return TriageResponse(
        priority=label,
        score=round(score, 4),
        trained_on=models.triage.trained_on,
        model_age_seconds=age,
    )
