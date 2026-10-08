"""Tests for the two models.

Everything here is in-memory. No database, no network, no fixtures to
start: the models take a list of issues, so they can be tested on a list of
issues.
"""

from __future__ import annotations

import pytest

from relay_ml.model import (
    MIN_TRAINING_EXAMPLES,
    DuplicateFinder,
    Issue,
    TriageModel,
    compose_text,
    labelled_issues,
)


def issue(id: str, title: str, description: str = "", priority: str | None = None) -> Issue:
    return Issue(id=id, title=title, description=description, priority=priority)


@pytest.fixture
def corpus() -> list[Issue]:
    return [
        issue("1", "Offline queue drops writes", "Mutations queued in IndexedDB are lost."),
        issue("2", "Queued offline writes are lost", "The IndexedDB mutation queue drops items."),
        issue("3", "Dark theme contrast on the board", "Column headers are unreadable."),
        issue("4", "Add CSV export to the issue list", "Download the current filter as CSV."),
    ]


class TestDuplicateFinder:
    def test_finds_the_restatement_of_an_existing_issue(self, corpus: list[Issue]) -> None:
        finder = DuplicateFinder(corpus)

        matches = finder.query("Offline writes in the queue get lost", threshold=0.1)

        assert matches, "expected the two offline-queue issues to surface"
        assert {m.id for m in matches[:2]} == {"1", "2"}

    def test_unrelated_text_matches_nothing(self, corpus: list[Issue]) -> None:
        finder = DuplicateFinder(corpus)

        assert finder.query("Update the billing address on the invoice") == []

    def test_an_issue_is_not_its_own_duplicate(self, corpus: list[Issue]) -> None:
        finder = DuplicateFinder(corpus)

        matches = finder.query(corpus[0].text, threshold=0.1, exclude_id="1")

        # Without the exclusion it scores 1.0 against itself and pushes the
        # real match off a short list.
        assert "1" not in {m.id for m in matches}
        assert "2" in {m.id for m in matches}

    def test_results_are_ordered_by_descending_score(self, corpus: list[Issue]) -> None:
        finder = DuplicateFinder(corpus)

        scores = [m.score for m in finder.query("offline queue writes lost", threshold=0.0)]

        assert scores == sorted(scores, reverse=True)

    def test_empty_corpus_and_empty_query_are_answers_not_crashes(self) -> None:
        assert DuplicateFinder([]).query("anything") == []
        assert DuplicateFinder([issue("1", "Sync protocol")]).query("   ") == []

    def test_a_corpus_of_only_stop_words_is_an_empty_index_not_a_crash(self) -> None:
        # "Something to do" is entirely stop words, so the vectorizer's
        # vocabulary comes out empty and sklearn raises. A workspace with one
        # vaguely-titled issue is a real state, so it must not 500.
        finder = DuplicateFinder([issue("1", "Something to do about it")])

        assert finder.query("Something to do") == []

    def test_threshold_excludes_weak_matches(self, corpus: list[Issue]) -> None:
        finder = DuplicateFinder(corpus)

        assert finder.query("offline queue", threshold=0.99) == []
        assert finder.query("offline queue", threshold=0.01)


class TestTriageModel:
    def test_declines_to_fit_on_too_few_examples(self, corpus: list[Issue]) -> None:
        model = TriageModel()

        assert model.fit(corpus) is False
        assert model.ready is False
        # The refusal is the product behaviour: a prediction from four rows
        # would look authoritative and mean nothing.
        assert model.predict("anything") is None

    def test_declines_when_every_example_has_the_same_label(self) -> None:
        single_class = [
            issue(str(n), f"Issue {n}", "body", priority="MEDIUM")
            for n in range(MIN_TRAINING_EXAMPLES + 10)
        ]

        model = TriageModel()

        assert model.fit(single_class) is False
        assert model.trained_on == len(single_class)

    def test_fits_and_predicts_a_known_label(self) -> None:
        # Two clearly separable vocabularies, repeated past the minimum so
        # the model is allowed to fit at all.
        training = []
        for n in range(MIN_TRAINING_EXAMPLES):
            if n % 2 == 0:
                training.append(
                    issue(f"u{n}", "Production outage data loss", "urgent crash", priority="URGENT")
                )
            else:
                training.append(
                    issue(f"l{n}", "Tidy up the footer spacing", "cosmetic nit", priority="LOW")
                )

        model = TriageModel()
        assert model.fit(training) is True
        assert model.ready is True

        prediction = model.predict("Production crash causing data loss")
        assert prediction is not None

        label, confidence = prediction
        assert label == "URGENT"
        assert 0.0 <= confidence <= 1.0

    def test_unlabelled_issues_are_not_counted_as_training_data(self) -> None:
        mixed = [issue(str(n), f"Issue {n}", "body") for n in range(100)]

        model = TriageModel()

        assert model.fit(mixed) is False
        assert model.trained_on == 0


class TestIssueText:
    def test_title_is_weighted_by_repetition(self) -> None:
        assert issue("1", "Sync", "body").text == "Sync Sync body"

    def test_a_missing_description_does_not_leave_trailing_space(self) -> None:
        assert Issue(id="1", title="Sync", description=None).text == "Sync Sync"

    def test_whitespace_is_normalised(self) -> None:
        assert compose_text("  Sync  ", "  body  ") == "Sync Sync body"

    def test_the_query_and_the_corpus_use_the_same_composition(self) -> None:
        """Guards against train/serve skew.

        The service builds its query text from the same function. If these
        ever diverge, a query is weighted differently from the corpus it is
        scored against and every similarity score shifts silently.
        """
        for title, description in [
            ("Sync protocol", "queue ordering"),
            ("Sync protocol", None),
            ("  padded  ", "  body  "),
        ]:
            assert (
                Issue(id="1", title=title, description=description).text
                == compose_text(title, description)
            )


class TestLabelledIssues:
    def test_none_is_not_a_label(self) -> None:
        """`NONE` is Relay's column default, not a priority anyone chose.

        `if issue.priority` is true for the string "NONE", which counted
        every untriaged issue as training data and put rows in the test set
        that the model can never predict.
        """
        issues = [
            issue("1", "Triaged", priority="HIGH"),
            issue("2", "Untriaged", priority="NONE"),
            issue("3", "Null priority", priority=None),
        ]

        assert [i.id for i in labelled_issues(issues)] == ["1"]

    def test_untriaged_issues_do_not_count_toward_the_training_minimum(self) -> None:
        issues = [
            issue(str(n), f"Issue {n}", priority="NONE") for n in range(MIN_TRAINING_EXAMPLES * 2)
        ]

        model = TriageModel()

        assert model.fit(issues) is False
        assert model.trained_on == 0
