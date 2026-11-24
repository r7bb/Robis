"""Shared test setup.

The service uses sentence embeddings wherever the model's files are present.
Its tests pin the word TF-IDF path, so they read the same on a laptop that
fetched the model and in CI, which has not; `test_embeddings.py` covers the
other path where the files exist.
"""

from __future__ import annotations

import pytest

from robis_ml.embeddings import OFF_ENV


@pytest.fixture(autouse=True)
def _word_tfidf_unless_asked(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(OFF_ENV, "off")
