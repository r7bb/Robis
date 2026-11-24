"""Tests for the second labelled set (D1).

The loader is strict, the split is seeded, stratified and fixed, and the
test half has exactly one reader: `report`. None of these tests scores the
shipped set; scoring it is the report's job, done once.
"""

from __future__ import annotations

import ast
import json
from collections import Counter
from pathlib import Path

import pytest

from robis_ml import independent_eval
from robis_ml.independent_eval import (
    KINDS,
    SPLIT_PATH,
    WANTED,
    IndependentQuery,
    load_independent_set,
    main,
    stratified_split,
)

ROOT = Path(__file__).resolve().parents[1]


def _write(tmp_path: Path, **overrides: object) -> Path:
    payload: dict[str, object] = {
        "author": "a second author",
        "written": "2026-11-24",
        "corpus": [
            {"id": "c01", "title": "Login fails", "topic": "sign in"},
            {"id": "c02", "title": "Invoice wrong", "topic": "billing"},
        ],
        "queries": [
            {
                "id": "q001",
                "title": "Logging in failing",
                "kind": "word_form",
                "topic": "sign in",
                "duplicates": ["c01"],
            },
            {
                "id": "q002",
                "title": "Login page colour",
                "kind": "hard_negative",
                "topic": "sign in",
                "duplicates": [],
            },
        ],
    }
    payload.update(overrides)
    path = tmp_path / "set.json"
    path.write_text(json.dumps(payload))
    return path


class TestLoader:
    def test_reads_a_well_formed_set(self, tmp_path: Path) -> None:
        loaded = load_independent_set(_write(tmp_path))
        assert [q.kind for q in loaded.queries] == ["word_form", "hard_negative"]
        assert loaded.topics == {"c01": "sign in", "c02": "billing"}

    @pytest.mark.parametrize(
        ("query", "message"),
        [
            ({"kind": "paraphrase"}, "unknown kind"),
            ({"duplicates": []}, "names no duplicates"),
            ({"duplicates": ["c99"]}, "not in the corpus"),
            ({"topic": "cooking"}, "no corpus issue has"),
            ({"title": "  "}, "non-blank"),
        ],
    )
    def test_refuses_a_bad_query(self, tmp_path: Path, query: dict, message: str) -> None:
        good = {
            "id": "q001",
            "title": "Logging in failing",
            "kind": "word_form",
            "topic": "sign in",
            "duplicates": ["c01"],
        }
        with pytest.raises(ValueError, match=message):
            load_independent_set(_write(tmp_path, queries=[good | query]))

    def test_refuses_a_negative_with_duplicates_and_repeated_ids(self, tmp_path: Path) -> None:
        negative = {
            "id": "q001",
            "title": "x",
            "kind": "unrelated",
            "topic": "billing",
            "duplicates": ["c02"],
        }
        with pytest.raises(ValueError, match="names duplicates"):
            load_independent_set(_write(tmp_path, queries=[negative]))
        twice = [negative | {"duplicates": []}, negative | {"duplicates": []}]
        with pytest.raises(ValueError, match="repeated"):
            load_independent_set(_write(tmp_path, queries=twice))

    def test_needs_an_author(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="author"):
            load_independent_set(_write(tmp_path, author=""))


def _queries(per_stratum: dict[tuple[str, str], int]) -> list[IndependentQuery]:
    made = []
    for (kind, topic), count in per_stratum.items():
        for n in range(count):
            made.append(IndependentQuery(f"{kind}-{topic}-{n}", "t", kind, topic, frozenset()))
    return made


class TestSplit:
    def test_halves_every_stratum_and_stays_level(self) -> None:
        queries = _queries({("word_form", "a"): 4, ("synonym", "a"): 3, ("synonym", "b"): 3})
        split = stratified_split(queries)
        tested = Counter((q.kind, q.topic) for q in queries if split[q.id] == "test")
        assert tested[("word_form", "a")] == 2
        assert {tested[("synonym", "a")], tested[("synonym", "b")]} == {1, 2}
        assert sum(1 for half in split.values() if half == "test") == 5

    def test_is_the_same_every_time_and_differs_with_the_seed(self) -> None:
        queries = _queries({("word_form", "a"): 10})
        assert stratified_split(queries) == stratified_split(list(reversed(queries)))
        assert stratified_split(queries) != stratified_split(queries, seed="another")


class TestShippedSet:
    def test_meets_the_guide(self) -> None:
        loaded = load_independent_set()
        counts = Counter(q.kind for q in loaded.queries)
        assert {kind: counts[kind] for kind in KINDS} == WANTED
        assert len(loaded.corpus) == 40
        assert max(Counter(d for q in loaded.queries for d in q.duplicates).values()) <= 6

    def test_says_who_wrote_it(self) -> None:
        assert "not an independent author" in load_independent_set().author

    def test_its_committed_split_is_the_seeded_one(self) -> None:
        committed = json.loads(SPLIT_PATH.read_text())
        assert committed == stratified_split(load_independent_set().queries)

    def test_split_is_never_rewritten(self, capsys: pytest.CaptureFixture[str]) -> None:
        assert main(["split"]) == 1
        assert "never rewritten" in capsys.readouterr().err


class TestFreeze:
    """The test half is read by `report` and nothing else."""

    def test_only_report_reads_the_test_half(self) -> None:
        callers: list[str] = []
        for path in [*ROOT.glob("robis_ml/**/*.py"), *ROOT.glob("tests/**/*.py")]:
            tree = ast.parse(path.read_text())
            for function in ast.walk(tree):
                if not isinstance(function, ast.FunctionDef | ast.AsyncFunctionDef):
                    continue
                for node in ast.walk(function):
                    if (
                        isinstance(node, ast.Call)
                        and isinstance(node.func, ast.Name)
                        and node.func.id == "_read_test_half"
                    ):
                        callers.append(f"{path.name}:{function.name}")
        assert set(callers) == {"independent_eval.py:report"}

    def test_nothing_else_names_the_test_half_reader(self) -> None:
        mentions = [
            path.name
            for path in [*ROOT.glob("robis_ml/**/*.py"), *ROOT.glob("tests/**/*.py")]
            if "_read_test_half" in path.read_text()
        ]
        assert sorted(mentions) == ["independent_eval.py", "test_independent_eval.py"]

    def test_report_refuses_without_a_committed_split(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(independent_eval, "SPLIT_PATH", tmp_path / "split.json")
        with pytest.raises(ValueError, match="does not exist yet"):
            independent_eval.report(load_independent_set())
