"""Measure the triage model, honestly.

    python -m robis_ml.evaluate <workspace-id>

Exists so that "the model works" is a number somebody can reproduce rather
than an impression. What this does that a naive script would not:

**Repeated stratified k-fold, not one split.** A single 25% holdout on a few
hundred rows gives a macro-F1 that moves by tens of points depending on the
seed, and printing it to three decimals implies a precision that is not
there. Repeating the fold gives a mean and a spread, and the spread is the
more honest half.

**Macro-F1, not accuracy.** Priorities are imbalanced: most of a real
backlog is MEDIUM. A model that answers MEDIUM to everything scores well on
accuracy and is worthless. Macro averages per class, so ignoring URGENT
entirely costs a quarter of the score.

**The baseline on the same folds.** A score means nothing alone. If the
model cannot beat "always answer the most common label", it has learned
nothing, and the comparison is the first thing a reader should see.

**A time-ordered holdout as well.** The random folds above are optimistic
for this corpus: it is full of paraphrases, so a near-duplicate can sit in
train while its twin sits in test. Training on the oldest issues and
testing on the newest is what production actually looks like.

**Brier score.** The service returns a probability. Nothing elsewhere
checks whether it means anything, so it is measured here.
"""

from __future__ import annotations

import statistics
import sys
from collections import Counter

from sklearn.dummy import DummyClassifier
from sklearn.metrics import brier_score_loss, classification_report, f1_score
from sklearn.model_selection import RepeatedStratifiedKFold

from .data import load_issues
from .model import MIN_TRAINING_EXAMPLES, Issue, TriageModel, labelled_issues

#: Folds, and how many times the whole thing is repeated with a new shuffle.
#: Five folds keeps each training set at 80%, close to how the model is
#: actually fitted; repeating five times turns one noisy number into a mean
#: with a spread.
FOLDS = 5
REPEATS = 5

#: The last slice, by creation time, held out for the realistic number.
TIME_HOLDOUT = 0.25

RANDOM_STATE = 20_251_008

#: How far past the baseline the model must score to count as having
#: learned anything.
#:
#: Not zero. Tested against a corpus of random labels, the model scored
#: macro-F1 0.259 where the majority-class baseline scored 0.193, and a
#: bare "greater than" let that through as a pass. It had learned nothing;
#: it just spread its guesses across three classes while the degenerate
#: baseline put everything in one, and macro-F1 rewards the spreading.
MIN_MARGIN = 0.05

#: Enough labelled issues that each training fold still clears the model's
#: own minimum. Gating on the raw total let 40 through and then watched the
#: fit decline on the 80% that remained.
MIN_FOR_EVALUATION = int(MIN_TRAINING_EXAMPLES / (1 - 1 / FOLDS)) + 1


def _fit_and_score(train: list[Issue], test: list[Issue]) -> tuple[float, float] | None:
    """Macro-F1 for the model and for the majority-class baseline."""
    model = TriageModel()
    if not model.fit(train):
        return None

    truth = [issue.priority for issue in test]

    predictions = [model.predict(issue.text) for issue in test]
    if any(p is None for p in predictions):
        raise RuntimeError("model returned no prediction after reporting itself fitted")

    predicted = [p[0] for p in predictions if p is not None]

    """
    The baseline guesses in proportion to the training class frequencies,
    which is what a model with no signal effectively does. The obvious
    alternative, always answering the most common label, is far weaker:
    it scores near zero on macro-F1 by construction, so beating it proves
    only that the model emits more than one class.
    """
    guesser = DummyClassifier(strategy="stratified", random_state=RANDOM_STATE)
    train_labels = [issue.priority for issue in train]
    guesser.fit([[0]] * len(train), train_labels)
    guessed = guesser.predict([[0]] * len(test))

    return (
        f1_score(truth, predicted, average="macro", zero_division=0),
        f1_score(truth, guessed, average="macro", zero_division=0),
    )


def _cross_validated(labelled: list[Issue]) -> tuple[list[float], list[float]]:
    labels = [issue.priority for issue in labelled]

    splitter = RepeatedStratifiedKFold(
        n_splits=FOLDS, n_repeats=REPEATS, random_state=RANDOM_STATE
    )

    model_scores: list[float] = []
    baseline_scores: list[float] = []

    for train_index, test_index in splitter.split(labelled, labels):
        scored = _fit_and_score(
            [labelled[i] for i in train_index], [labelled[i] for i in test_index]
        )
        if scored is None:
            continue

        model_scores.append(scored[0])
        baseline_scores.append(scored[1])

    return model_scores, baseline_scores


def _time_ordered(labelled: list[Issue]) -> tuple[float, float] | None:
    """Train on the oldest, test on the newest.

    `load_issues` returns rows ordered by `created_at`, so this slice is
    chronological without needing the timestamp itself. It is the
    pessimistic number and the realistic one: in production every issue the
    model scores is newer than everything it trained on.
    """
    cut = int(len(labelled) * (1 - TIME_HOLDOUT))
    train, test = labelled[:cut], labelled[cut:]

    if len(train) < MIN_TRAINING_EXAMPLES or not test:
        return None

    return _fit_and_score(train, test)


def _calibration(labelled: list[Issue]) -> float | None:
    """Brier score on the model's own confidence, lower is better.

    Measured one-vs-rest against the most common class, because a
    multiclass Brier needs the full probability vector and the service only
    ever exposes the top one. It answers the question the API raises: when
    it says 0.8, is it right about 80% of the time?
    """
    cut = int(len(labelled) * (1 - TIME_HOLDOUT))
    train, test = labelled[:cut], labelled[cut:]

    if len(train) < MIN_TRAINING_EXAMPLES or not test:
        return None

    model = TriageModel()
    if not model.fit(train):
        return None

    target = Counter(issue.priority for issue in train).most_common(1)[0][0]

    actual: list[int] = []
    confidence: list[float] = []

    for issue in test:
        prediction = model.predict(issue.text)
        if prediction is None:
            continue

        label, score = prediction
        actual.append(1 if issue.priority == target else 0)
        # The probability assigned to `target`: `score` when the model picked
        # it, the remainder otherwise. An approximation, and the right one
        # for an API that returns a single label.
        confidence.append(score if label == target else 1 - score)

    if len(set(actual)) < 2:
        return None

    return float(brier_score_loss(actual, confidence))


def evaluate(issues: list[Issue]) -> int:
    # `labelled_issues`, not `if issue.priority`. "NONE" is the column
    # default and a truthy string, so the naive filter counted every
    # untriaged issue as a labelled example and scored the model on a class
    # it can never output.
    labelled = labelled_issues(issues)

    if len(labelled) < MIN_FOR_EVALUATION:
        print(
            f"{len(labelled)} issues carry a real priority; need at least "
            f"{MIN_FOR_EVALUATION} so each training fold still clears the model's "
            f"{MIN_TRAINING_EXAMPLES}-example minimum.\n"
            "Nothing is reported rather than reporting a number from too little data."
        )
        return 1

    counts = Counter(issue.priority for issue in labelled)
    if min(counts.values()) < FOLDS:
        rare = {label: n for label, n in counts.items() if n < FOLDS}
        print(f"Cannot run {FOLDS}-fold stratified CV: {rare} have fewer than {FOLDS} examples.")
        return 1

    print(f"{len(labelled)} labelled issues  classes {dict(counts)}")
    print(f"{FOLDS}-fold stratified CV, repeated {REPEATS}x\n")

    model_scores, baseline_scores = _cross_validated(labelled)
    if not model_scores:
        print("Every fold declined to fit.")
        return 1

    model_mean = statistics.mean(model_scores)
    model_sd = statistics.stdev(model_scores) if len(model_scores) > 1 else 0.0
    baseline_mean = statistics.mean(baseline_scores)

    print(
        f"  macro-F1  model     {model_mean:.3f} +/- {model_sd:.3f}"
        f"   over {len(model_scores)} folds"
    )
    print(f"  macro-F1  baseline  {baseline_mean:.3f}           stratified random guess")
    print(f"  range               {min(model_scores):.3f} to {max(model_scores):.3f}")

    ordered = _time_ordered(labelled)
    if ordered:
        print(f"\n  time-ordered holdout  model {ordered[0]:.3f}  baseline {ordered[1]:.3f}")
        print("  (train on the oldest, test on the newest: what production looks like)")

    brier = _calibration(labelled)
    if brier is not None:
        print(f"\n  Brier score  {brier:.3f}   lower is better; 0.25 is a coin flip")

    # The per-class picture, from the time-ordered split rather than a
    # random one, so it matches the number above it.
    cut = int(len(labelled) * (1 - TIME_HOLDOUT))
    report_model = TriageModel()
    if report_model.fit(labelled[:cut]):
        test = labelled[cut:]
        predicted = [(report_model.predict(i.text) or ("MEDIUM", 0.0))[0] for i in test]
        print()
        print(classification_report([i.priority for i in test], predicted, zero_division=0))

    margin = model_mean - baseline_mean
    print(f"\n  margin over baseline  {margin:+.3f}   must clear {MIN_MARGIN:+.3f}")

    if margin < MIN_MARGIN:
        # Non-zero, so a promotion gate fails on this rather than printing a
        # warning into a log nobody reads.
        print("\nThe model does not clear the baseline by enough. Treat it as no signal.")
        return 1

    return 0


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python -m robis_ml.evaluate <workspace-id>")
        return 2

    return evaluate(load_issues(sys.argv[1]))


if __name__ == "__main__":
    raise SystemExit(main())
