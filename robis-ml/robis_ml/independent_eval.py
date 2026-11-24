"""The second labelled set for the duplicate finder (D1).

    python -m robis_ml.independent_eval check    # is the file well formed? no scores
    python -m robis_ml.independent_eval split    # fix dev and test, once, before any score
    python -m robis_ml.independent_eval report   # score the test half, once

The first set (`datasets/duplicates.json`) was written by the model's author
and its test half has been read, so it can no longer confirm a change. This
set is written to `datasets/independent/GUIDE.md` and tagged by gap kind:

- ``word_form``: a duplicate in other forms of the same words
- ``synonym``: a duplicate with words swapped for ones meaning the same
- ``lexical_gap``: a duplicate sharing almost no words
- ``hard_negative``: not a duplicate, but sharing words
- ``unrelated``: not a duplicate, about something else

**The split is fixed before any score exists.** `split` assigns each query to
dev or test, stratified by gap kind and topic with a fixed seed, and writes
`split.json`, which is committed before `report` is ever run. It refuses to
overwrite one that exists.

**The test half is read in one place.** Only `report` calls
`_read_test_half`; a test fails if anything else does, so the half stays
untouched until the report is written, and stays meaningful afterwards only
for that report.
"""

from __future__ import annotations

import json
import random
import sys
from collections import Counter, defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, NoReturn

from .duplicate_eval import (
    COMPARISON_THRESHOLDS,
    DISPLAYED_LIMIT,
    REPRESENTATIONS,
    LabelledQuery,
    LabelledSet,
    Metrics,
    Scored,
    choose_threshold,
    metrics_at,
    score_queries,
    shown,
    wilson_interval,
)
from .model import DEFAULT_DUPLICATE_THRESHOLD, Issue, TextVectorizer, word_vectorizer

FOLDER = Path(__file__).parent / "datasets" / "independent"
SET_PATH = FOLDER / "independent.json"
SPLIT_PATH = FOLDER / "split.json"

POSITIVE_KINDS = ("word_form", "synonym", "lexical_gap")
NEGATIVE_KINDS = ("hard_negative", "unrelated")
KINDS = POSITIVE_KINDS + NEGATIVE_KINDS

#: How many of each kind the guide asks for.
WANTED = {"word_form": 25, "synonym": 25, "lexical_gap": 20, "hard_negative": 30, "unrelated": 20}

#: Fixed before the set was written; changing it would be choosing a split.
SPLIT_SEED = "robis-d1-2026-11-24"

#: The open candidate the report runs beside production.
CANDIDATE = "char_wb 3-5"


@dataclass(frozen=True)
class IndependentQuery:
    id: str
    title: str
    kind: str
    topic: str
    duplicates: frozenset[str]


@dataclass(frozen=True)
class IndependentSet:
    author: str
    written: str
    corpus: tuple[Issue, ...]
    topics: dict[str, str]
    queries: tuple[IndependentQuery, ...]


def _fail(message: str) -> NoReturn:
    raise ValueError(f"independent set: {message}")


def _text(raw: dict[str, Any], field: str, where: str) -> str:
    value = raw.get(field)
    if not isinstance(value, str) or not value.strip():
        _fail(f"{where} needs {field!r} as non-blank text, not {value!r}")
    return value.strip()


def _unique(kind: str, ids: Sequence[str]) -> None:
    repeated = [item for item, n in Counter(ids).items() if n > 1]
    if repeated:
        _fail(f"{kind} ids repeated: {sorted(repeated)}")


def _parse_corpus(rows: list[Any]) -> tuple[tuple[Issue, ...], dict[str, str]]:
    corpus: list[Issue] = []
    topics: dict[str, str] = {}
    for index, raw in enumerate(rows):
        if not isinstance(raw, dict):
            _fail(f"corpus entry {index} is not an object")
        issue_id = _text(raw, "id", f"corpus entry {index}")
        where = f"corpus issue {issue_id}"
        description = raw.get("description") or None
        if description is not None and not isinstance(description, str):
            _fail(f"{where} has a description that is not text")
        corpus.append(Issue(id=issue_id, title=_text(raw, "title", where), description=description))
        topics[issue_id] = _text(raw, "topic", where)
    _unique("corpus", [issue.id for issue in corpus])
    return tuple(corpus), topics


def _parse_query(raw: Any, index: int, topics: dict[str, str]) -> IndependentQuery:
    if not isinstance(raw, dict):
        _fail(f"query entry {index} is not an object")
    query_id = _text(raw, "id", f"query entry {index}")
    where = f"query {query_id}"
    kind = _text(raw, "kind", where)
    topic = _text(raw, "topic", where)
    listed = raw.get("duplicates", [])
    if not isinstance(listed, list) or not all(isinstance(d, str) for d in listed):
        _fail(f"{where} needs 'duplicates' as a list of corpus ids")
    duplicates = frozenset(listed)
    if kind not in KINDS:
        _fail(f"{where} has unknown kind {kind!r}")
    if kind in POSITIVE_KINDS and not duplicates:
        _fail(f"{where} is {kind} but names no duplicates")
    if kind in NEGATIVE_KINDS and duplicates:
        _fail(f"{where} is {kind} but names duplicates")
    unknown = duplicates - topics.keys()
    if unknown:
        _fail(f"{where} points at {sorted(unknown)}, which are not in the corpus")
    if topic not in set(topics.values()):
        _fail(f"{where} has topic {topic!r}, which no corpus issue has")
    return IndependentQuery(query_id, _text(raw, "title", where), kind, topic, duplicates)


def load_independent_set(path: Path = SET_PATH) -> IndependentSet:
    """Read and validate the set strictly: a typo in an id must fail, not lower a score."""
    payload = json.loads(Path(path).read_text())
    if not isinstance(payload, dict):
        _fail("the file is not an object")
    for section in ("corpus", "queries"):
        if not isinstance(payload.get(section), list) or not payload[section]:
            _fail(f"{section!r} must be a non-empty list")
    corpus, topics = _parse_corpus(payload["corpus"])
    queries = tuple(_parse_query(raw, i, topics) for i, raw in enumerate(payload["queries"]))
    _unique("query", [q.id for q in queries])
    return IndependentSet(
        author=_text(payload, "author", "the set"),
        written=_text(payload, "written", "the set"),
        corpus=corpus,
        topics=topics,
        queries=queries,
    )


def stratified_split(queries: Sequence[IndependentQuery], seed: str = SPLIT_SEED) -> dict[str, str]:
    """Half of each (kind, topic) stratum to test, chosen by a seeded shuffle.

    Strata are visited in a fixed order and an odd one's spare goes to dev
    and test in turn, so the halves stay level overall.
    """
    strata: dict[tuple[str, str], list[str]] = defaultdict(list)
    for q in queries:
        strata[(q.kind, q.topic)].append(q.id)
    assignment: dict[str, str] = {}
    spare_to_test = True
    for key in sorted(strata):
        ids = sorted(strata[key])
        random.Random(f"{seed}:{key[0]}:{key[1]}").shuffle(ids)
        half = len(ids) // 2
        if len(ids) % 2:
            half += 1 if spare_to_test else 0
            spare_to_test = not spare_to_test
        for position, query_id in enumerate(ids):
            assignment[query_id] = "test" if position < half else "dev"
    return dict(sorted(assignment.items()))


def _as_labelled(independent: IndependentSet, split: dict[str, str]) -> LabelledSet:
    """The set in the first evaluation's shape, so the same scoring and metrics apply."""

    def category(kind: str) -> str:
        # word_form and synonym are paraphrases in the first set's terms.
        return "paraphrase" if kind in ("word_form", "synonym") else kind

    return LabelledSet(
        corpus=independent.corpus,
        queries=tuple(
            LabelledQuery(
                id=q.id,
                title=q.title,
                category=category(q.kind),
                duplicates=q.duplicates,
                split=split[q.id],
            )
            for q in independent.queries
        ),
    )


def _read_split(independent: IndependentSet) -> dict[str, str]:
    if not SPLIT_PATH.exists():
        _fail("split.json does not exist yet: run `split` and commit it before any report")
    split = json.loads(SPLIT_PATH.read_text())
    if split != stratified_split(independent.queries):
        _fail("split.json does not match the seeded split of this set: the set changed after it")
    return split


def _read_dev_half(independent: IndependentSet) -> list[Scored]:
    split = _read_split(independent)
    results = score_queries(_as_labelled(independent, split), vectorizer=REPRESENTATIONS[CANDIDATE])
    return [r for r in results if r.query.split == "dev"]


def _read_test_half(
    independent: IndependentSet, vectorizer: Callable[[], TextVectorizer] = word_vectorizer
) -> list[Scored]:
    """The only reader of the test half. Called from `report` alone."""
    split = _read_split(independent)
    results = score_queries(_as_labelled(independent, split), vectorizer=vectorizer)
    return [r for r in results if r.query.split == "test"]


def _interval(successes: int, trials: int) -> str:
    bounds = wilson_interval(successes, trials)
    if bounds is None:
        return f"{successes}/{trials}"
    low, high = bounds
    return f"{successes}/{trials} = {successes / trials:.2f} [{low:.2f}, {high:.2f}]"


def _kind_recall(
    independent: IndependentSet, results: Sequence[Scored], threshold: float
) -> dict[str, tuple[int, int]]:
    """Pairs found per gap kind, the split the first set could not make."""
    kinds = {q.id: q.kind for q in independent.queries}
    tally: dict[str, list[int]] = {kind: [0, 0] for kind in POSITIVE_KINDS}
    for result in results:
        kind = kinds[result.query.id]
        if kind not in tally:
            continue
        found = {s.id for s in shown(result, threshold, DISPLAYED_LIMIT)}
        tally[kind][0] += len(found & result.query.duplicates)
        tally[kind][1] += len(result.query.duplicates)
    return {kind: (found, total) for kind, (found, total) in tally.items()}


def _report_lines(name: str, m: Metrics, kinds: dict[str, tuple[int, int]]) -> list[str]:
    hard = m.false_alarms_by_category.get("hard_negative", (0, 0))
    lines = [
        f"{name} at threshold {m.threshold:.2f}",
        f"  precision            {_interval(m.true_positives, m.predicted)}",
        f"  recall               {_interval(m.true_positives, m.labelled)}",
        f"  hard negative alarms {_interval(*hard)}",
    ]
    lines += [f"  recall, {kind:<12} {_interval(*kinds[kind])}" for kind in POSITIVE_KINDS]
    return lines


def report(independent: IndependentSet) -> int:
    """Production and the candidate on the test half, each threshold fixed beforehand.

    Production keeps the threshold it ships with; the candidate's is chosen on
    the dev half. Nothing is chosen on the test half.
    """
    sections: list[list[str]] = []
    candidate_threshold = choose_threshold(
        _read_dev_half(independent), COMPARISON_THRESHOLDS
    ).threshold
    for name, vectorizer, threshold in (
        ("production (word TF-IDF)", word_vectorizer, DEFAULT_DUPLICATE_THRESHOLD),
        (f"candidate ({CANDIDATE})", REPRESENTATIONS[CANDIDATE], candidate_threshold),
    ):
        results = _read_test_half(independent, vectorizer)
        measured = metrics_at(results, threshold)
        sections.append(
            _report_lines(name, measured, _kind_recall(independent, results, threshold))
        )

    print(
        f"{len(independent.corpus)} issues, {len(independent.queries)} queries, "
        f"written by {independent.author}"
    )
    print("test half only; 95% Wilson intervals\n")
    print("\n\n".join("\n".join(lines) for lines in sections))
    return 0


def check(independent: IndependentSet) -> int:
    """Whether the file is complete against the guide. Never scores anything."""
    counts = Counter(q.kind for q in independent.queries)
    print(f"author: {independent.author}, written {independent.written}")
    print(
        f"{len(independent.corpus)} corpus issues across {len(set(independent.topics.values()))} topics"
    )
    short = False
    for kind in KINDS:
        mark = "" if counts[kind] >= WANTED[kind] else f"  (the guide asks for {WANTED[kind]})"
        short = short or bool(mark)
        print(f"  {kind:<14} {counts[kind]:>3}{mark}")
    pointed = Counter(d for q in independent.queries for d in q.duplicates)
    crowded = sorted(issue for issue, n in pointed.items() if n > 6)
    if crowded:
        print(f"more than six duplicates point at {crowded}")
    return 1 if short or crowded else 0


def write_split(independent: IndependentSet) -> int:
    if SPLIT_PATH.exists():
        print("split.json already exists; it is fixed once and never rewritten", file=sys.stderr)
        return 1
    split = stratified_split(independent.queries)
    SPLIT_PATH.write_text(json.dumps(split, indent=2) + "\n")
    tested = sum(1 for half in split.values() if half == "test")
    print(
        f"wrote split.json: {tested} test, {len(split) - tested} dev. Commit it before any report."
    )
    return 0


COMMANDS = {"check": check, "split": write_split, "report": report}
USAGE = "usage: python -m robis_ml.independent_eval {check|split|report}"


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1 or args[0] not in COMMANDS:
        print(USAGE, file=sys.stderr)
        return 2
    try:
        independent = load_independent_set()
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    try:
        return COMMANDS[args[0]](independent)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
