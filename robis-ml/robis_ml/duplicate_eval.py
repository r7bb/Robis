"""Measure the duplicate finder against a labelled set.

    python -m robis_ml.duplicate_eval

`evaluate.py` measures the triage model against a live workspace. This one
needs no database: the labelled set ships in the package, because a set of
true duplicate pairs does not exist in any workspace and had to be written.

**What is measured is what the composer shows.** A person types a title.
The API sends it to this service, which returns up to five matches over the
default threshold, then keeps the top three and shows them as hints. So each
query here is a bare title, embedded with `compose_text` exactly as the
service embeds it, ranked against the corpus, cut at the threshold and then
at three.

**Pairs, not queries.** A query with two true duplicates that surfaces one
of them has found half of what it should, and recall says so.

**A false alarm is a hint shown to somebody filing something new.** It is
counted once per negative query, whatever the number of wrong matches,
because that is how often a person sees a hint they did not need.

**The threshold is chosen on one split and reported on the other.** Every
query was assigned to ``dev`` or ``test`` when it was written, before any
score existed. Picking the best of eleven thresholds on a set and quoting
the number from the same set reports the luck of the pick as accuracy.

**Small numbers get intervals.** Fifty-odd pairs cannot support a figure to
three decimals, so every rate is printed with a Wilson 95% interval.
"""

from __future__ import annotations

import json
import math
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, NoReturn

from .model import (
    DEFAULT_DUPLICATE_THRESHOLD,
    DEFAULT_SIMILAR_LIMIT,
    DuplicateFinder,
    Issue,
    Similar,
    compose_text,
)

DEFAULT_SET = Path(__file__).parent / "datasets" / "duplicates.json"

#: A query whose title restates an existing issue in different words.
#: ``lexical_gap`` is the subset where the two share almost no tokens
#: ("auth" against "authentication"), which TF-IDF cannot see through and
#: which is reported separately so it cannot hide inside an average.
POSITIVE_CATEGORIES = ("paraphrase", "lexical_gap")

#: A query that duplicates nothing. ``hard_negative`` shares vocabulary with
#: a corpus issue while meaning something else ("rate limit the auth
#: endpoints" against "rate limit the search endpoint"); ``unrelated`` does
#: not. The first is where false alarms come from.
NEGATIVE_CATEGORIES = ("hard_negative", "unrelated")

CATEGORIES = POSITIVE_CATEGORIES + NEGATIVE_CATEGORIES

SPLITS = ("dev", "test")

#: How many hints reach the screen. The service returns up to
#: `DEFAULT_SIMILAR_LIMIT`, and the API keeps the top ``MAX_SUGGESTIONS`` of
#: those (``backend/api/src/suggestions.ts``). A test reads that constant so
#: the two cannot drift apart unnoticed.
API_MAX_SUGGESTIONS = 3
DISPLAYED_LIMIT = min(API_MAX_SUGGESTIONS, DEFAULT_SIMILAR_LIMIT)

#: The candidate thresholds, 0.10 to 0.60 in steps of 0.05.
THRESHOLDS = tuple(round(0.10 + 0.05 * step, 2) for step in range(11))

#: Two-sided 95%.
Z_95 = 1.96


@dataclass(frozen=True)
class LabelledQuery:
    id: str
    title: str
    category: str
    duplicates: frozenset[str]
    split: str


@dataclass(frozen=True)
class LabelledSet:
    corpus: tuple[Issue, ...]
    queries: tuple[LabelledQuery, ...]


@dataclass(frozen=True)
class Scored:
    """One query and every corpus issue ranked against it, best first."""

    query: LabelledQuery
    ranked: tuple[Similar, ...]


@dataclass(frozen=True)
class Metrics:
    threshold: float
    true_positives: int
    predicted: int
    labelled: int
    false_alarms: int
    negatives: int
    #: category -> (pairs found, pairs labelled)
    recall_by_category: dict[str, tuple[int, int]]
    #: category -> (queries with any hint, queries)
    false_alarms_by_category: dict[str, tuple[int, int]]
    #: Duplicate queries shown at least one of their true duplicates: the
    #: person about to file a repeat saw the original. Pair recall can fall
    #: short of this when a query has several duplicates.
    queries_helped: int = 0
    positive_queries: int = 0

    @property
    def precision(self) -> float | None:
        """None when nothing was predicted: no hints is not perfect hints."""
        return self.true_positives / self.predicted if self.predicted else None

    @property
    def recall(self) -> float:
        return self.true_positives / self.labelled if self.labelled else 0.0

    @property
    def f1(self) -> float:
        if not self.true_positives or self.precision is None:
            return 0.0
        return 2 * self.precision * self.recall / (self.precision + self.recall)


def _fail(message: str) -> NoReturn:
    raise ValueError(f"labelled set: {message}")


def _text(raw: dict[str, Any], field: str, where: str) -> str:
    """A required, non-blank string field.

    Checked rather than coerced: ``str(None)`` is ``"None"``, which would be
    scored as a real title and quietly become a query about nothing.
    """
    if field not in raw:
        _fail(f"{where} is missing {field!r}")

    value = raw[field]
    if not isinstance(value, str) or not value.strip():
        _fail(f"{where} has a {field!r} that is not non-blank text: {value!r}")

    return value


def _parse_issue(raw: dict[str, Any], index: int) -> Issue:
    issue_id = _text(raw, "id", f"corpus entry {index}")
    where = f"corpus issue {issue_id}"
    description = raw.get("description")
    if description is not None and not isinstance(description, str):
        _fail(f"{where} has a description that is not text")

    return Issue(id=issue_id, title=_text(raw, "title", where), description=description)


def _parse_query(raw: dict[str, Any], index: int, corpus_ids: set[str]) -> LabelledQuery:
    query_id = _text(raw, "id", f"query entry {index}")
    where = f"query {query_id}"
    title = _text(raw, "title", where)
    category = _text(raw, "category", where)
    split = _text(raw, "split", where)
    duplicates = frozenset(str(d) for d in raw.get("duplicates", []))

    if category not in CATEGORIES:
        _fail(f"{where} has unknown category {category!r}")
    if split not in SPLITS:
        _fail(f"{where} has unknown split {split!r}")
    if category in POSITIVE_CATEGORIES and not duplicates:
        _fail(f"query {query_id} is {category} but lists no duplicates")
    if category in NEGATIVE_CATEGORIES and duplicates:
        _fail(f"query {query_id} is {category} but lists duplicates")

    unknown = duplicates - corpus_ids
    if unknown:
        _fail(f"query {query_id} points at {sorted(unknown)}, which are not in the corpus")

    return LabelledQuery(
        id=query_id,
        title=title,
        category=category,
        duplicates=duplicates,
        split=split,
    )


def _reject_repeats(kind: str, ids: Iterable[str]) -> None:
    seen: set[str] = set()
    for item in ids:
        if item in seen:
            _fail(f"{kind} id {item!r} is repeated")
        seen.add(item)


def load_labelled_set(path: Path = DEFAULT_SET) -> LabelledSet:
    """Read and validate the set.

    Strict on purpose. A duplicate id with a typo in it would not crash
    anything; it would quietly become a pair nobody can find and lower the
    recall, which is far worse than an error.
    """
    payload = json.loads(Path(path).read_text())
    for section in ("corpus", "queries"):
        if not isinstance(payload.get(section), list):
            _fail(f"{section!r} must be a list")

    corpus = tuple(_parse_issue(row, i) for i, row in enumerate(payload["corpus"]))
    _reject_repeats("corpus", (issue.id for issue in corpus))

    corpus_ids = {issue.id for issue in corpus}
    queries = tuple(_parse_query(row, i, corpus_ids) for i, row in enumerate(payload["queries"]))
    _reject_repeats("query", (q.id for q in queries))

    return LabelledSet(corpus=corpus, queries=queries)


def score_queries(labelled: LabelledSet) -> list[Scored]:
    """Rank the whole corpus against every query, through the real model."""
    finder = DuplicateFinder(list(labelled.corpus))
    everything = len(labelled.corpus)

    return [
        Scored(
            query=q,
            ranked=tuple(
                finder.query(compose_text(q.title, None), limit=everything, threshold=0.0)
            ),
        )
        for q in labelled.queries
    ]


def shown(result: Scored, threshold: float, limit: int) -> list[Similar]:
    """What the composer would display: over the bar, then the top few.

    The same filter-then-limit as `DuplicateFinder.query`, applied to one
    full ranking so a single scoring pass covers every threshold. A test
    checks the two agree on every shipped query.
    """
    return [m for m in result.ranked if m.score >= threshold][:limit]


def metrics_at(
    results: Sequence[Scored], threshold: float, limit: int = DISPLAYED_LIMIT
) -> Metrics:
    true_positives = predicted = labelled = false_alarms = negatives = 0
    queries_helped = positive_queries = 0
    recall_by: dict[str, tuple[int, int]] = {}
    alarms_by: dict[str, tuple[int, int]] = {}

    for result in results:
        hinted = {m.id for m in shown(result, threshold, limit)}
        category = result.query.category
        predicted += len(hinted)

        if category in POSITIVE_CATEGORIES:
            found = len(hinted & result.query.duplicates)
            wanted = len(result.query.duplicates)
            true_positives += found
            labelled += wanted
            positive_queries += 1
            queries_helped += 1 if found else 0
            hit, total = recall_by.get(category, (0, 0))
            recall_by = {**recall_by, category: (hit + found, total + wanted)}
        else:
            alarmed = 1 if hinted else 0
            false_alarms += alarmed
            negatives += 1
            hit, total = alarms_by.get(category, (0, 0))
            alarms_by = {**alarms_by, category: (hit + alarmed, total + 1)}

    return Metrics(
        threshold=threshold,
        true_positives=true_positives,
        predicted=predicted,
        labelled=labelled,
        false_alarms=false_alarms,
        negatives=negatives,
        recall_by_category=recall_by,
        false_alarms_by_category=alarms_by,
        queries_helped=queries_helped,
        positive_queries=positive_queries,
    )


def wilson_interval(successes: int, trials: int, z: float = Z_95) -> tuple[float, float] | None:
    """Wilson score interval for a binomial proportion.

    Rather than the textbook ``p +/- z*sqrt(p(1-p)/n)``, which collapses to
    a zero-width interval at 0% or 100% -- exactly where a small set lands
    most often -- and can run outside [0, 1].
    """
    if trials < 0 or not 0 <= successes <= max(trials, 0):
        raise ValueError(f"{successes} successes in {trials} trials is not a proportion")
    if trials == 0:
        return None

    p = successes / trials
    denominator = 1 + z**2 / trials
    centre = (p + z**2 / (2 * trials)) / denominator
    spread = z * math.sqrt(p * (1 - p) / trials + z**2 / (4 * trials**2)) / denominator

    return max(0.0, centre - spread), min(1.0, centre + spread)


def choose_threshold(results: Sequence[Scored], thresholds: Iterable[float]) -> Metrics:
    """The threshold with the best pair F1; on a tie, the stricter one.

    F1 is a neutral default, fixed before any score was seen, not a rule
    derived from the product. An advisory hint might reasonably weight false
    alarms more heavily, and the full sweep is printed so a different rule
    can be argued from the same numbers. What must not happen is choosing
    the rule after seeing which threshold it picks. Ties go up because an
    equal score at a higher bar shows fewer hints to people who did not ask
    for them.

    Refuses rather than guesses when there is nothing to choose from: with
    no hits anywhere every F1 is 0 and the tie-break would return the
    highest threshold, which would look like a decision.
    """
    if not results:
        raise ValueError("cannot choose a threshold: the split has no queries")

    candidates = [metrics_at(results, t) for t in sorted(thresholds)]
    if not candidates:
        raise ValueError("cannot choose a threshold: no candidates were given")

    best = max(candidates, key=lambda m: (round(m.f1, 9), m.threshold))
    if best.f1 == 0.0:
        raise ValueError("cannot choose a threshold: no threshold finds a single duplicate")

    return best


def _rate(successes: int, trials: int) -> str:
    interval = wilson_interval(successes, trials)
    if interval is None:
        return "     n/a"
    low, high = interval
    return f"{successes / trials:.2f} [{low:.2f}-{high:.2f}] ({successes}/{trials})"


def _print_metrics(m: Metrics) -> None:
    print(f"  precision     {_rate(m.true_positives, m.predicted)}   of hints shown")
    print(f"  recall        {_rate(m.true_positives, m.labelled)}   of duplicate pairs")
    print(f"  helped        {_rate(m.queries_helped, m.positive_queries)}   saw the original")
    print(f"  F1            {m.f1:.2f}")
    for category, (hit, total) in sorted(m.recall_by_category.items()):
        print(f"    recall        {category:<14}{_rate(hit, total)}")
    # Per category first: the overall rate depends on how many hard
    # negatives the set's author chose to write.
    for category, (hit, total) in sorted(m.false_alarms_by_category.items()):
        print(f"    false alarms  {category:<14}{_rate(hit, total)}")
    print(f"    false alarms  {'all negatives':<14}{_rate(m.false_alarms, m.negatives)}")


def _print_sweep(results: Sequence[Scored]) -> None:
    print("  threshold  precision  recall   F1    false alarms")
    for t in THRESHOLDS:
        m = metrics_at(results, t)
        precision = f"{m.precision:.2f}" if m.precision is not None else " n/a"
        alarms = m.false_alarms / m.negatives if m.negatives else 0.0
        print(f"    {t:.2f}       {precision}     {m.recall:.2f}   {m.f1:.2f}   {alarms:.2f}")


def evaluate(labelled: LabelledSet) -> int:
    results = score_queries(labelled)
    dev = [r for r in results if r.query.split == "dev"]
    test = [r for r in results if r.query.split == "test"]

    print(
        f"{len(labelled.corpus)} corpus issues, {len(labelled.queries)} labelled queries "
        f"({len(dev)} dev, {len(test)} test), "
        f"at most {DISPLAYED_LIMIT} hints shown, as in the composer\n"
    )

    print("dev split, every threshold:")
    _print_sweep(dev)

    chosen = choose_threshold(dev, THRESHOLDS)
    print(f"\nbest F1 on dev at {chosen.threshold:.2f}. Reported on the untouched test split:\n")
    _print_metrics(metrics_at(test, chosen.threshold))

    if chosen.threshold != DEFAULT_DUPLICATE_THRESHOLD:
        print(
            f"\nmodel.DEFAULT_DUPLICATE_THRESHOLD is {DEFAULT_DUPLICATE_THRESHOLD:.2f}, "
            f"but dev chose {chosen.threshold:.2f}. Update the constant or explain why not."
        )
        return 1

    return 0


def main() -> int:
    if len(sys.argv) > 2:
        print("usage: python -m robis_ml.duplicate_eval [labelled-set.json]", file=sys.stderr)
        return 2

    path = Path(sys.argv[1]) if len(sys.argv) == 2 else DEFAULT_SET
    try:
        labelled = load_labelled_set(path)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1

    return evaluate(labelled)


if __name__ == "__main__":
    raise SystemExit(main())
