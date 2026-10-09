"""Two models over the text of Robis issues.

Both are built on a single TF-IDF representation rather than sentence
embeddings from a pretrained transformer. That is a deliberate choice, and
the honest reasons are in order of weight:

1. The corpus is one workspace's issues. A few hundred short, highly
   domain-specific documents full of identifiers like ``REL-41`` and
   ``SKIP LOCKED`` is close to the best case for lexical matching and close
   to the worst case for a general-purpose embedding model, which will have
   seen none of this vocabulary.
2. It trains in milliseconds on a laptop, with no GPU, no warm-up and no
   model weights to ship or version.
3. Model weights cannot be downloaded in the environment this was built in
   (``cdn-lfs.huggingface.co`` is unreachable), so a transformer baseline
   could not have been measured here even to compare against.

Point 3 is a constraint, not a justification, and it is recorded so nobody
later mistakes this for a considered rejection of embeddings. If the corpus
grows or goes multilingual, a bi-encoder is the obvious next thing to try,
and ``evaluate.py`` exists so that comparison can be made on numbers.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics.pairwise import cosine_similarity

#: The priorities worth predicting.
#:
#: Robis's enum is ``('NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT')`` and ``NONE``
#: is the column default, so most rows carry it without anybody having chosen
#: it. It is the *absence* of a priority, not a fifth one, and training on it
#: would teach the model to predict "nobody triaged this yet".
#:
#: This distinction is easy to lose: ``if issue.priority`` is true for the
#: string ``"NONE"``, which silently counted every untriaged issue as a
#: labelled example. Hence `labelled_issues` below, which every caller uses
#: instead of writing its own filter.
PRIORITIES = ("LOW", "MEDIUM", "HIGH", "URGENT")

UNTRIAGED = "NONE"


def compose_text(title: str, description: str | None) -> str:
    """The single definition of how an issue becomes a document.

    Both the corpus and the query go through here. They used to be two
    implementations that happened to agree, which is a train/serve skew bug
    waiting for somebody to edit one of them: a query weighted differently
    from the corpus it is scored against skews every result silently.

    The title is repeated because it is the strongest signal in a short
    document and TF-IDF has no other way to be told that.
    """
    body = (description or "").strip()
    clean_title = title.strip()

    return f"{clean_title} {clean_title} {body}".strip()


def labelled_issues(issues: list[Issue]) -> list[Issue]:
    """Issues a human actually assigned a priority to."""
    return [i for i in issues if i.priority in PRIORITIES]


#: Below this many labelled issues the triage model declines to predict.
#:
#: A classifier fitted on a handful of examples will still return a label and
#: a confident-looking probability, and that number is worse than no answer:
#: it invites a reviewer to trust it. Refusing is the correct output for a
#: cold workspace.
MIN_TRAINING_EXAMPLES = 40

#: Cosine similarity above which two issues are worth showing as possible
#: duplicates.
#:
#: Chosen by `duplicate_eval.py` as the best F1 on the dev half of the
#: labelled set, and a test asserts the two still agree. Read it as "the
#: numbers do not argue for anything else", not as a sharp optimum: dev
#: preferred it to the old hand-tuned 0.35 by 0.02 F1, and the held-out test
#: half preferred 0.35 by 0.04. Both gaps are a pair or two, inside the
#: noise. The threshold was not re-picked on test, because that would make
#: the test number meaningless. The API returns the score, so a caller can
#: still apply its own bar.
DEFAULT_DUPLICATE_THRESHOLD = 0.40

#: How many possible duplicates to return by default, here and from the
#: service's ``/similar`` route. The API keeps fewer of them than this for
#: the composer; `duplicate_eval.DISPLAYED_LIMIT` is what reaches the screen.
DEFAULT_SIMILAR_LIMIT = 5


@dataclass(frozen=True)
class Issue:
    """One labelled issue. ``priority`` is None for unlabelled rows."""

    id: str
    title: str
    description: str | None
    priority: str | None = None

    @property
    def text(self) -> str:
        """Title and body as one document. See `compose_text`."""
        return compose_text(self.title, self.description)


@dataclass(frozen=True)
class Similar:
    id: str
    title: str
    score: float


class TextVectorizer(Protocol):
    """Anything that turns documents into rows: TF-IDF, a union of several."""

    def fit_transform(self, raw_documents: list[str]) -> Any: ...

    def transform(self, raw_documents: list[str]) -> Any: ...


def word_vectorizer() -> TfidfVectorizer:
    """Shared text representation, and the one both models use in production.

    ``sublinear_tf`` because a word repeated nine times in a bug report is
    not nine times as important as one mentioned once. ``min_df=1`` because
    the corpus is small enough that discarding rare terms throws away most
    of what distinguishes two issues.
    """
    return TfidfVectorizer(
        lowercase=True,
        stop_words="english",
        ngram_range=(1, 2),
        min_df=1,
        sublinear_tf=True,
    )


class DuplicateFinder:
    """Nearest neighbours in TF-IDF space.

    Unsupervised, so it works on a brand-new workspace the moment there are
    two issues in it. That is the main reason this and the triage model are
    separate: one needs labels and one does not, and tying them together
    would mean neither worked until both could.
    """

    def __init__(
        self,
        issues: list[Issue],
        vectorizer: Callable[[], TextVectorizer] = word_vectorizer,
    ) -> None:
        """Index ``issues`` for nearest-neighbour search.

        ``vectorizer`` exists so `duplicate_eval` can compare alternatives
        through this class rather than a copy of it. Production never passes
        one.
        """
        self._issues = issues
        self._vectorizer = vectorizer()
        self._matrix = self._fit(issues)

    def _fit(self, issues: list[Issue]):
        """Build the matrix, or decide there is nothing to search.

        ``fit_transform`` raises when the vocabulary comes out empty, which
        happens for a corpus whose documents are entirely stop words -- a
        workspace with one issue called "Something to do" is enough. That is
        a legitimate state, not an error, so it becomes an empty index that
        matches nothing rather than an exception from a constructor.
        """
        if not issues:
            return None

        # A list, not a generator: a vectorizer that reads its input more
        # than once (a FeatureUnion does, once per branch) gets nothing on
        # every pass after the first, and fits an index of zeros.
        try:
            return self._vectorizer.fit_transform([i.text for i in issues])
        except ValueError:
            return None

    def query(
        self,
        text: str,
        limit: int = DEFAULT_SIMILAR_LIMIT,
        threshold: float = DEFAULT_DUPLICATE_THRESHOLD,
        exclude_id: str | None = None,
    ) -> list[Similar]:
        if self._matrix is None or not text.strip():
            return []

        scores = cosine_similarity(self._vectorizer.transform([text]), self._matrix)[0]

        ranked = sorted(
            (
                Similar(issue.id, issue.title, float(score))
                for issue, score in zip(self._issues, scores, strict=True)
                # An issue is always its own nearest neighbour at 1.0, which
                # would push a real match off the end of a short list.
                if issue.id != exclude_id and score >= threshold
            ),
            key=lambda s: s.score,
            reverse=True,
        )

        return ranked[:limit]


class TriageModel:
    """Predict an issue's priority from its text.

    Multinomial logistic regression over the same TF-IDF features. Linear
    and probabilistic on purpose: the coefficients are inspectable, so when
    it says URGENT somebody can ask which words did that, which matters more
    for a suggestion a human overrides than another point of accuracy would.

    ``class_weight="balanced"`` because real backlogs are mostly MEDIUM. An
    unweighted model learns to answer MEDIUM to everything and scores well
    on accuracy while being useless, which is why ``evaluate.py`` reports
    macro-F1 instead.
    """

    def __init__(self) -> None:
        self._vectorizer = word_vectorizer()
        self._classifier: LogisticRegression | None = None
        self._trained_on = 0

    @property
    def ready(self) -> bool:
        return self._classifier is not None

    @property
    def trained_on(self) -> int:
        return self._trained_on

    def fit(self, issues: list[Issue]) -> bool:
        """Fit, or decline and say so.

        Returns whether a model was produced. Two ways to fail honestly:
        too few labelled examples, or every example carrying the same label
        (a classifier with one class cannot discriminate and sklearn will
        not fit one).
        """
        labelled = labelled_issues(issues)

        if len(labelled) < MIN_TRAINING_EXAMPLES:
            self._classifier = None
            self._trained_on = len(labelled)
            return False

        labels = [i.priority for i in labelled]
        if len(set(labels)) < 2:
            self._classifier = None
            self._trained_on = len(labelled)
            return False

        # A list for the same reason as in `DuplicateFinder._fit`.
        features = self._vectorizer.fit_transform([i.text for i in labelled])
        self._classifier = LogisticRegression(
            max_iter=1000,
            class_weight="balanced",
        ).fit(features, labels)
        self._trained_on = len(labelled)

        return True

    def predict(self, text: str) -> tuple[str, float] | None:
        """Label and its probability, or None when the model is not fit."""
        if self._classifier is None:
            return None

        features = self._vectorizer.transform([text])
        probabilities = self._classifier.predict_proba(features)[0]
        best = int(probabilities.argmax())

        return str(self._classifier.classes_[best]), float(probabilities[best])
