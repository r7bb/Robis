"""Tests for the embedding candidate (D2), without the model files.

The blend's arithmetic and the file checks are tested with stand-ins; the
model itself is exercised by `independent_eval compare` where its files are
present, and skipped with a reason where they are not.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from sklearn.feature_extraction.text import TfidfVectorizer

from robis_ml import auth, embeddings
from robis_ml.embeddings import FILES, Blend, MiniLMVectorizer, verified


class FixedSentences:
    """Two-dimensional 'embeddings' that put matching words side by side."""

    def __init__(self, table: dict[str, list[float]]) -> None:
        self._table = table

    def transform(self, docs: list[str]) -> np.ndarray:
        return np.array([self._table[d] for d in docs], dtype=float)

    def fit_transform(self, docs: list[str]) -> np.ndarray:
        return self.transform(docs)


def _cos(a: np.ndarray, b: np.ndarray) -> float:
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))


def test_the_blend_is_the_weighted_mean_of_the_two_similarities() -> None:
    docs = ["login broken", "sign in fails", "login page colour"]
    sentences = FixedSentences({docs[0]: [1, 0], docs[1]: [0.9, 0.1], docs[2]: [0, 1]})
    words = TfidfVectorizer().fit(docs)
    blend = Blend(TfidfVectorizer(), sentences, weight=0.3)
    rows = blend.fit_transform(docs)

    word_rows = words.transform(docs).toarray()
    sentence_rows = sentences.transform(docs)
    expected = 0.3 * _cos(word_rows[0], word_rows[1]) + 0.7 * _cos(
        sentence_rows[0], sentence_rows[1]
    )
    assert float(rows[0] @ rows[1]) == pytest.approx(expected)
    assert np.linalg.norm(rows, axis=1) == pytest.approx([1, 1, 1])


def test_a_weight_outside_zero_to_one_is_refused() -> None:
    with pytest.raises(ValueError, match="share"):
        Blend(TfidfVectorizer(), FixedSentences({}), weight=1.5)


def test_files_that_do_not_match_are_not_used(tmp_path: Path) -> None:
    for file in FILES:
        embeddings.local_path(file, tmp_path).write_bytes(b"not the model")
    assert not verified(tmp_path)
    with pytest.raises(FileNotFoundError, match="fetch"):
        MiniLMVectorizer(tmp_path)


def test_fetch_refuses_bytes_with_the_wrong_hash(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def pretend_download(url: str, target: Path) -> None:
        Path(target).write_bytes(b"tampered")

    monkeypatch.setattr(embeddings.urllib.request, "urlretrieve", pretend_download)
    with pytest.raises(ValueError, match="expected sha256"):
        embeddings.fetch(tmp_path)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.skipif(not verified(), reason="MiniLM files not fetched here")
def test_the_model_puts_a_reworded_title_closer_than_an_unrelated_one() -> None:
    vectors = MiniLMVectorizer().transform(
        [
            "App crashes when opening a photo",
            "Application closes when viewing an image",
            "Add dark mode",
        ]
    )
    assert vectors[0] @ vectors[1] > vectors[0] @ vectors[2]


def test_switched_off_the_service_stays_on_word_tfidf(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(auth.TOKEN_ENV, "a-test-token")
    from robis_ml import service
    from robis_ml.model import DEFAULT_DUPLICATE_THRESHOLD

    assert not embeddings.serving()
    assert service.duplicate_threshold() == DEFAULT_DUPLICATE_THRESHOLD


@pytest.mark.skipif(not verified(), reason="MiniLM files not fetched here")
def test_with_the_model_here_the_service_serves_it_at_its_measured_threshold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from robis_ml import service
    from robis_ml.model import Issue

    monkeypatch.setenv(auth.TOKEN_ENV, "a-test-token")
    monkeypatch.delenv(embeddings.OFF_ENV)
    assert service.duplicate_threshold() == embeddings.EMBEDDING_DUPLICATE_THRESHOLD
    finder = service._finder(
        [
            Issue(id="a", title="App crashes when opening a photo", description=None),
            Issue(id="b", title="Add dark mode", description=None),
        ]
    )
    found = finder.query("Application closes when viewing an image", threshold=0.5)
    assert [match.id for match in found] == ["a"]
