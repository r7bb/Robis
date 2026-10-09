"""Tests for the duplicate-detection evaluation.

Two kinds of test live here. The metric logic is checked against small
hand-built cases where the right answer can be worked out on paper. The
shipped labelled set is checked for integrity, because a typo in an id
would silently turn a true duplicate into a miss and lower every number.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from robis_ml import duplicate_eval
from robis_ml.duplicate_eval import (
    CATEGORIES,
    DISPLAYED_LIMIT,
    POSITIVE_CATEGORIES,
    THRESHOLDS,
    LabelledQuery,
    LabelledSet,
    Scored,
    choose_threshold,
    load_labelled_set,
    metrics_at,
    score_queries,
    shown,
    wilson_interval,
)
from robis_ml.model import (
    DEFAULT_DUPLICATE_THRESHOLD,
    DEFAULT_SIMILAR_LIMIT,
    DuplicateFinder,
    Issue,
    Similar,
    compose_text,
)

REPO = Path(__file__).resolve().parents[2]
SEED_SCRIPT = REPO / "scripts" / "db" / "seed.ts"
SUGGESTION_CLIENT = REPO / "backend" / "api" / "src" / "suggestions.ts"


def query(
    id: str,
    duplicates: tuple[str, ...] = (),
    category: str | None = None,
    split: str = "dev",
) -> LabelledQuery:
    return LabelledQuery(
        id=id,
        title=f"query {id}",
        category=category or ("paraphrase" if duplicates else "unrelated"),
        duplicates=frozenset(duplicates),
        split=split,
    )


def scored(q: LabelledQuery, *matches: tuple[str, float]) -> Scored:
    return Scored(
        query=q,
        ranked=tuple(Similar(id=i, title=i, score=s) for i, s in matches),
    )


class TestMetricsAt:
    def test_a_perfect_ranking_scores_one_everywhere(self) -> None:
        results = [
            scored(query("q1", ("a",)), ("a", 0.9), ("b", 0.1)),
            scored(query("q2", ("b",)), ("b", 0.8), ("a", 0.2)),
        ]

        m = metrics_at(results, threshold=0.5)

        assert (m.precision, m.recall, m.f1) == (1.0, 1.0, 1.0)

    def test_counts_pairs_not_queries(self) -> None:
        # One query with two true duplicates, only one of which clears the
        # bar: recall is one of two pairs, not "the query was answered".
        results = [scored(query("q1", ("a", "b")), ("a", 0.7), ("b", 0.3))]

        m = metrics_at(results, threshold=0.5)

        assert (m.true_positives, m.labelled, m.predicted) == (1, 2, 1)
        assert m.recall == 0.5
        assert m.precision == 1.0

    def test_a_wrong_hint_costs_precision(self) -> None:
        results = [scored(query("q1", ("a",)), ("b", 0.9), ("a", 0.6))]

        m = metrics_at(results, threshold=0.5)

        assert m.precision == 0.5
        assert m.recall == 1.0

    def test_no_hints_at_all_leaves_precision_undefined_not_perfect(self) -> None:
        results = [scored(query("q1", ("a",)), ("a", 0.2))]

        m = metrics_at(results, threshold=0.5)

        assert m.predicted == 0
        assert m.precision is None
        assert m.recall == 0.0
        assert m.f1 == 0.0

    def test_applies_the_limit_after_the_threshold_like_the_api(self) -> None:
        results = [
            scored(
                query("q1", ("e",)),
                ("a", 0.9),
                ("b", 0.8),
                ("c", 0.7),
                ("d", 0.6),
                ("e", 0.55),
            )
        ]

        m = metrics_at(results, threshold=0.5, limit=4)

        assert m.predicted == 4
        assert m.true_positives == 0

    def test_counts_a_false_alarm_once_per_negative_query(self) -> None:
        results = [
            scored(query("n1"), ("a", 0.9), ("b", 0.8)),
            scored(query("n2"), ("a", 0.1)),
        ]

        m = metrics_at(results, threshold=0.5)

        assert (m.false_alarms, m.negatives) == (1, 2)

    def test_reports_recall_per_positive_category(self) -> None:
        results = [
            scored(query("p", ("a",), "paraphrase"), ("a", 0.9)),
            scored(query("g", ("b",), "lexical_gap"), ("b", 0.2)),
        ]

        m = metrics_at(results, threshold=0.5)

        assert m.recall_by_category == {"paraphrase": (1, 1), "lexical_gap": (0, 1)}

    def test_a_score_exactly_on_the_threshold_is_shown(self) -> None:
        # `>=`, matching DuplicateFinder.query.
        results = [scored(query("q1", ("a",)), ("a", 0.4))]

        assert metrics_at(results, threshold=0.4).true_positives == 1

    def test_counts_duplicate_queries_that_got_at_least_one_right_hint(self) -> None:
        # What a person filing a duplicate experiences: was the issue they
        # were about to repeat in front of them or not.
        results = [
            scored(query("q1", ("a", "b")), ("a", 0.9)),
            scored(query("q2", ("c",)), ("d", 0.9)),
            scored(query("n1"), ("a", 0.9)),
        ]

        m = metrics_at(results, threshold=0.5)

        assert (m.queries_helped, m.positive_queries) == (1, 2)

    def test_reports_false_alarms_per_negative_category(self) -> None:
        results = [
            scored(query("h", (), "hard_negative"), ("a", 0.9)),
            scored(query("u", (), "unrelated"), ("a", 0.1)),
        ]

        m = metrics_at(results, threshold=0.5)

        assert m.false_alarms_by_category == {"hard_negative": (1, 1), "unrelated": (0, 1)}


class TestWilsonInterval:
    def test_no_trials_has_no_interval(self) -> None:
        assert wilson_interval(0, 0) is None

    def test_matches_the_textbook_value(self) -> None:
        low, high = wilson_interval(5, 10)

        assert low == pytest.approx(0.2366, abs=1e-4)
        assert high == pytest.approx(0.7634, abs=1e-4)

    def test_stays_inside_zero_and_one_at_the_extremes(self) -> None:
        low, high = wilson_interval(10, 10)

        assert low == pytest.approx(0.7225, abs=1e-4)
        assert high == pytest.approx(1.0)

    def test_zero_successes_still_has_a_nonzero_upper_bound(self) -> None:
        # The point of Wilson over the textbook interval: 0 of 7 is not
        # "certainly zero".
        low, high = wilson_interval(0, 7)

        assert low == pytest.approx(0.0)
        assert high == pytest.approx(0.3543, abs=1e-4)

    @pytest.mark.parametrize(("successes", "trials"), [(3, 2), (-1, 5), (1, -1)])
    def test_rejects_counts_that_are_not_a_proportion(self, successes: int, trials: int) -> None:
        with pytest.raises(ValueError):
            wilson_interval(successes, trials)


class TestChooseThreshold:
    def test_picks_the_threshold_with_the_best_f1(self) -> None:
        results = [
            scored(query("q1", ("a",)), ("a", 0.45), ("b", 0.3)),
            scored(query("n1"), ("a", 0.35)),
        ]

        best = choose_threshold(results, thresholds=(0.25, 0.40, 0.50))

        assert best.threshold == 0.40

    def test_breaks_a_tie_toward_the_higher_threshold(self) -> None:
        # Equal F1 means the stricter bar costs nothing, and shows fewer
        # hints to somebody who did not ask for them.
        results = [scored(query("q1", ("a",)), ("a", 0.9))]

        best = choose_threshold(results, thresholds=(0.3, 0.5, 0.7))

        assert best.threshold == 0.7

    def test_refuses_an_empty_split(self) -> None:
        with pytest.raises(ValueError, match="no queries"):
            choose_threshold([], thresholds=(0.3, 0.5))

    def test_refuses_to_pick_when_no_threshold_finds_anything(self) -> None:
        # Otherwise every F1 is 0, the tie-break returns the highest
        # threshold, and a hopeless split looks like a confident choice.
        results = [scored(query("q1", ("a",)), ("b", 0.9))]

        with pytest.raises(ValueError, match="no threshold"):
            choose_threshold(results, thresholds=(0.3, 0.5))


class TestLoadLabelledSet:
    def _write(self, tmp_path: Path, payload: dict) -> Path:
        path = tmp_path / "set.json"
        path.write_text(json.dumps(payload))
        return path

    def _valid(self) -> dict:
        return {
            "corpus": [{"id": "a", "title": "Rate limit login"}],
            "queries": [
                {
                    "id": "q1",
                    "title": "Throttle login",
                    "category": "paraphrase",
                    "duplicates": ["a"],
                    "split": "dev",
                }
            ],
        }

    def test_loads_a_valid_set(self, tmp_path: Path) -> None:
        loaded = load_labelled_set(self._write(tmp_path, self._valid()))

        assert loaded.corpus == (Issue(id="a", title="Rate limit login", description=None),)
        assert loaded.queries[0].duplicates == frozenset({"a"})

    def test_rejects_a_duplicate_that_points_at_no_issue(self, tmp_path: Path) -> None:
        payload = self._valid()
        payload["queries"][0]["duplicates"] = ["missing"]

        with pytest.raises(ValueError, match="missing"):
            load_labelled_set(self._write(tmp_path, payload))

    def test_rejects_an_unknown_category(self, tmp_path: Path) -> None:
        payload = self._valid()
        payload["queries"][0]["category"] = "similar-ish"

        with pytest.raises(ValueError, match="category"):
            load_labelled_set(self._write(tmp_path, payload))

    def test_rejects_a_positive_with_no_duplicates(self, tmp_path: Path) -> None:
        payload = self._valid()
        payload["queries"][0]["duplicates"] = []

        with pytest.raises(ValueError, match="duplicates"):
            load_labelled_set(self._write(tmp_path, payload))

    def test_rejects_a_negative_that_lists_duplicates(self, tmp_path: Path) -> None:
        payload = self._valid()
        payload["queries"][0]["category"] = "hard_negative"

        with pytest.raises(ValueError, match="duplicates"):
            load_labelled_set(self._write(tmp_path, payload))

    def test_rejects_repeated_ids(self, tmp_path: Path) -> None:
        payload = self._valid()
        payload["corpus"].append({"id": "a", "title": "Another"})

        with pytest.raises(ValueError, match="repeated"):
            load_labelled_set(self._write(tmp_path, payload))

    @pytest.mark.parametrize("field", ["id", "title", "category", "split"])
    def test_rejects_a_query_missing_a_field(self, tmp_path: Path, field: str) -> None:
        payload = self._valid()
        del payload["queries"][0][field]

        with pytest.raises(ValueError, match=field):
            load_labelled_set(self._write(tmp_path, payload))

    @pytest.mark.parametrize("title", [None, "", "   ", 7])
    def test_rejects_a_title_that_is_not_text(self, tmp_path: Path, title: object) -> None:
        # `str(None)` is "None", which would be scored as a real query.
        payload = self._valid()
        payload["corpus"][0]["title"] = title

        with pytest.raises(ValueError, match="title"):
            load_labelled_set(self._write(tmp_path, payload))

    def test_rejects_an_unknown_split(self, tmp_path: Path) -> None:
        payload = self._valid()
        payload["queries"][0]["split"] = "train"

        with pytest.raises(ValueError, match="split"):
            load_labelled_set(self._write(tmp_path, payload))


@pytest.fixture(scope="module")
def shipped() -> LabelledSet:
    return load_labelled_set()


class TestShippedSet:
    def test_contains_every_seeded_issue_title_verbatim(self, shipped: LabelledSet) -> None:
        # "Built from the seeded corpus" is a claim, so it is checked: if the
        # seed script changes, this fails rather than the set drifting away
        # from what the demo workspace actually contains.
        # Issue specs are the only seeded objects whose title is followed by
        # a status; documents and meetings are not.
        seeded = set(re.findall(r"title: '([^']+)',\s*status:", SEED_SCRIPT.read_text()))
        titles = {issue.title for issue in shipped.corpus}

        assert seeded, "the seed parser found no titles; the regex needs updating"
        assert seeded <= titles

    def test_every_category_appears_in_both_splits(self, shipped: LabelledSet) -> None:
        for split in ("dev", "test"):
            present = {q.category for q in shipped.queries if q.split == split}
            assert present == set(CATEGORIES), f"{split} is missing {set(CATEGORIES) - present}"

    def test_is_large_enough_to_say_anything(self, shipped: LabelledSet) -> None:
        positives = [q for q in shipped.queries if q.category in POSITIVE_CATEGORIES]
        negatives = [q for q in shipped.queries if q.category not in POSITIVE_CATEGORIES]

        assert len(positives) >= 40
        assert len(negatives) >= 30

    def test_query_titles_do_not_copy_a_corpus_title(self, shipped: LabelledSet) -> None:
        # A query identical to its target scores 1.0 and measures nothing.
        titles = {issue.title.casefold() for issue in shipped.corpus}

        assert not [q.title for q in shipped.queries if q.title.casefold() in titles]

    def test_the_default_threshold_is_the_one_the_dev_split_chose(
        self, shipped: LabelledSet
    ) -> None:
        # The constant in model.py is a decision taken from this evaluation.
        # If the data or the model changes and the best threshold moves, this
        # fails, so the constant cannot quietly go back to being a guess.
        dev = [s for s in score_queries(shipped) if s.query.split == "dev"]

        assert choose_threshold(dev, THRESHOLDS).threshold == DEFAULT_DUPLICATE_THRESHOLD

    @pytest.mark.parametrize("threshold", [0.25, DEFAULT_DUPLICATE_THRESHOLD, 0.55])
    def test_measures_exactly_what_the_finder_serves(
        self, shipped: LabelledSet, threshold: float
    ) -> None:
        # The evaluation re-applies the threshold and limit itself, so one
        # scoring pass covers every threshold. If the finder's own filtering
        # ever changes, this is what notices that the two have drifted.
        finder = DuplicateFinder(list(shipped.corpus))

        for result in score_queries(shipped):
            served = finder.query(compose_text(result.query.title, None), threshold=threshold)
            measured = shown(result, threshold, DEFAULT_SIMILAR_LIMIT)

            assert [m.id for m in measured] == [m.id for m in served], result.query.id


class TestMatchesTheComposer:
    """The evaluation claims to measure what reaches the screen.

    Between the service and the screen, the API drops anything under its own
    floor and keeps the top few. Both constants live in TypeScript, so they
    are read from source: if either moves, these fail rather than the
    evaluation quietly describing a composer that no longer exists.
    """

    def _constant(self, name: str) -> float:
        match = re.search(rf"const {name} = ([0-9.]+);", SUGGESTION_CLIENT.read_text())
        assert match, f"{name} not found in {SUGGESTION_CLIENT}; update this test"
        return float(match.group(1))

    def test_measures_at_the_number_of_hints_the_api_keeps(self) -> None:
        assert self._constant("MAX_SUGGESTIONS") == DISPLAYED_LIMIT

    def test_the_api_floor_does_not_cut_below_the_default_threshold(self) -> None:
        # Above the default, the API would be filtering hints this
        # evaluation counts as shown.
        assert self._constant("MIN_SCORE") <= DEFAULT_DUPLICATE_THRESHOLD


class TestReport:
    def test_reports_the_test_split_at_the_dev_threshold_and_succeeds(
        self, shipped: LabelledSet, capsys: pytest.CaptureFixture[str]
    ) -> None:
        code = duplicate_eval.evaluate(shipped)
        out = capsys.readouterr().out

        assert code == 0
        assert f"best F1 on dev at {DEFAULT_DUPLICATE_THRESHOLD:.2f}" in out
        assert "untouched test split" in out
        # Every category is broken out, so a weak one cannot hide in the mean.
        for category in CATEGORIES:
            assert category in out

    def test_fails_when_the_constant_disagrees_with_the_evaluation(
        self,
        shipped: LabelledSet,
        capsys: pytest.CaptureFixture[str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(duplicate_eval, "DEFAULT_DUPLICATE_THRESHOLD", 0.15)

        code = duplicate_eval.evaluate(shipped)

        assert code == 1
        assert "Update the constant" in capsys.readouterr().out

    def test_main_reads_a_set_from_the_path_given(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        path = tmp_path / "copy.json"
        path.write_text(duplicate_eval.DEFAULT_SET.read_text())
        monkeypatch.setattr("sys.argv", ["duplicate_eval", str(path)])

        assert duplicate_eval.main() == 0

    def test_main_rejects_extra_arguments(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr("sys.argv", ["duplicate_eval", "a.json", "b.json"])

        assert duplicate_eval.main() == 2

    def test_main_reports_a_broken_set_in_one_line(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        path = tmp_path / "broken.json"
        path.write_text(json.dumps({"corpus": [], "queries": [{"id": "q1"}]}))
        monkeypatch.setattr("sys.argv", ["duplicate_eval", str(path)])

        code = duplicate_eval.main()
        err = capsys.readouterr().err

        assert code == 1
        assert err.startswith("labelled set:")
        assert "Traceback" not in err
