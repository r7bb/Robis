"""Sentence embeddings as a duplicate-finding candidate (D2).

    python -m robis_ml.embeddings fetch

The small MiniLM sentence model (sentence-transformers/all-MiniLM-L6-v2,
Apache 2.0) run on the CPU through ONNX Runtime, with no PyTorch. The weights
are fetched once, at a pinned revision, and each file is checked against a
SHA-256 recorded here before it is used; a file that does not match is
refused. Evaluation only: production does not import this module.

A text's vector is the mean of its token vectors, normalised, as the model
was trained to be used, so cosine similarity is a dot product.

**Served since D2.** The duplicate finder uses it when its files are here and
verify (the ML image fetches them at build time), at the threshold its
measurement chose; otherwise, or with ``ROBIS_ML_EMBEDDINGS=off``, it stays
on word TF-IDF. One model serves every workspace, with a bounded cache of
vectors by text: a vector is only ever compared inside the request that
asked, so sharing the cache shares no workspace's issues with another.
"""

from __future__ import annotations

import hashlib
import logging
import os
import sys
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize

REPO = "sentence-transformers/all-MiniLM-L6-v2"
#: The commit the files are fetched from, so the same bytes come every time.
REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"


@dataclass(frozen=True)
class ModelFile:
    path: str
    sha256: str


#: The model's SHA-256 matches the hash the host publishes for it; the
#: tokenizer's was recorded at the first fetch, on 2026-11-24.
FILES = (
    ModelFile(
        "onnx/model.onnx", "6fd5d72fe4589f189f8ebc006442dbb529bb7ce38f8082112682524616046452"
    ),
    ModelFile("tokenizer.json", "be50c3628f2bf5bb5e3a7f17b1f74611b2561a3a27eeab05e5aa30f411572037"),
)

MODEL_DIR = Path(
    os.environ.get(
        "ROBIS_ML_MODEL_DIR", Path(__file__).resolve().parents[1] / ".models" / "all-MiniLM-L6-v2"
    )
)
MAX_TOKENS = 128
BATCH = 32
#: Vectors kept by text: about 1.5 KB each, so some 30 MB at the cap.
CACHE_SIZE = 20_000

#: Chosen on the second labelled set's dev half and confirmed on its test half
#: (recall 0.66, precision 0.88, 1 of 15 hard negatives raised): see the ML README.
EMBEDDING_DUPLICATE_THRESHOLD = 0.55

OFF_ENV = "ROBIS_ML_EMBEDDINGS"

logger = logging.getLogger(__name__)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def local_path(file: ModelFile, folder: Path = MODEL_DIR) -> Path:
    return folder / Path(file.path).name


def verified(folder: Path = MODEL_DIR) -> bool:
    """Whether every file is here with the bytes it should have."""
    return all(
        local_path(f, folder).exists() and _sha256(local_path(f, folder)) == f.sha256 for f in FILES
    )


def fetch(folder: Path = MODEL_DIR) -> None:
    """Download any missing file at the pinned revision, refusing one that does not match."""
    folder.mkdir(parents=True, exist_ok=True)
    for file in FILES:
        target = local_path(file, folder)
        if target.exists() and _sha256(target) == file.sha256:
            continue
        url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{file.path}"
        partial = target.with_suffix(target.suffix + ".part")
        urllib.request.urlretrieve(url, partial)
        actual = _sha256(partial)
        if actual != file.sha256:
            partial.unlink()
            raise ValueError(f"{file.path}: expected sha256 {file.sha256}, got {actual}")
        partial.replace(target)


class MiniLMVectorizer:
    """Turns texts into normalised sentence vectors, the way a TF-IDF vectorizer turns them into rows."""

    def __init__(self, folder: Path = MODEL_DIR) -> None:
        if not verified(folder):
            raise FileNotFoundError(
                "the MiniLM files are missing or do not match: run `python -m robis_ml.embeddings fetch`"
            )
        # ONNX Runtime has telemetry of its own, read at import: it is switched
        # off before the import and again once loaded, so nothing leaves.
        os.environ.setdefault("ORT_DISABLE_TELEMETRY", "1")
        import onnxruntime
        from tokenizers import Tokenizer

        onnxruntime.disable_telemetry_events()

        self._tokenizer = Tokenizer.from_file(str(local_path(FILES[1], folder)))
        self._tokenizer.enable_truncation(MAX_TOKENS)
        self._tokenizer.enable_padding()
        self._session = onnxruntime.InferenceSession(
            str(local_path(FILES[0], folder)), providers=["CPUExecutionProvider"]
        )
        self._inputs = {i.name for i in self._session.get_inputs()}
        self._cache: OrderedDict[str, np.ndarray] = OrderedDict()
        self._lock = Lock()

    def _encode(self, texts: list[str]) -> np.ndarray:
        encodings = self._tokenizer.encode_batch(texts)
        ids = np.array([e.ids for e in encodings], dtype=np.int64)
        mask = np.array([e.attention_mask for e in encodings], dtype=np.int64)
        feeds: dict[str, Any] = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in self._inputs:
            feeds["token_type_ids"] = np.zeros_like(ids)
        tokens = self._session.run(None, feeds)[0]
        weights = mask[:, :, None].astype(np.float32)
        pooled = (tokens * weights).sum(axis=1) / np.clip(weights.sum(axis=1), 1e-9, None)
        return normalize(pooled)

    def transform(self, raw_documents: list[str]) -> np.ndarray:
        with self._lock:
            known = {t: self._cache[t] for t in raw_documents if t in self._cache}
            for text in known:
                self._cache.move_to_end(text)
        missing = [t for t in dict.fromkeys(raw_documents) if t not in known]
        for start in range(0, len(missing), BATCH):
            batch = missing[start : start + BATCH]
            known.update(zip(batch, self._encode(batch), strict=True))
        with self._lock:
            for text in missing:
                self._cache[text] = known[text]
            while len(self._cache) > CACHE_SIZE:
                self._cache.popitem(last=False)
        return np.vstack([known[t] for t in raw_documents])

    def fit_transform(self, raw_documents: list[str]) -> np.ndarray:
        return self.transform(raw_documents)


class Blend:
    """TF-IDF and embeddings together: each half normalised and weighted so the
    cosine of the joined vectors is ``weight * tfidf + (1 - weight) * embedding``.
    """

    def __init__(self, words: TfidfVectorizer, sentences: Any, weight: float = 0.5) -> None:
        if not 0.0 <= weight <= 1.0:
            raise ValueError("the weight is a share between 0 and 1")
        self._words = words
        self._sentences = sentences
        self._weight = weight

    def _join(self, word_rows: Any, sentence_rows: np.ndarray) -> np.ndarray:
        words = normalize(
            np.asarray(word_rows.toarray() if hasattr(word_rows, "toarray") else word_rows)
        )
        sentences = normalize(np.asarray(sentence_rows))
        return np.hstack([np.sqrt(self._weight) * words, np.sqrt(1 - self._weight) * sentences])

    def fit_transform(self, raw_documents: list[str]) -> np.ndarray:
        return self._join(
            self._words.fit_transform(raw_documents), self._sentences.fit_transform(raw_documents)
        )

    def transform(self, raw_documents: list[str]) -> np.ndarray:
        return self._join(
            self._words.transform(raw_documents), self._sentences.transform(raw_documents)
        )


_shared: MiniLMVectorizer | None = None
_shared_lock = Lock()


def serving() -> bool:
    """Whether the service should use embeddings: switched on, and the files verify."""
    if os.environ.get(OFF_ENV, "").lower() in ("off", "0", "false"):
        return False
    return verified()


def shared_vectorizer() -> MiniLMVectorizer:
    """The one model the service loads, built on first use."""
    global _shared
    with _shared_lock:
        if _shared is None:
            _shared = MiniLMVectorizer()
            logger.info("duplicates: MiniLM sentence embeddings loaded from %s", MODEL_DIR)
        return _shared


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if args != ["fetch"]:
        print("usage: python -m robis_ml.embeddings fetch", file=sys.stderr)
        return 2
    fetch()
    print(f"MiniLM files verified in {MODEL_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
