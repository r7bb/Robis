"""Measure the triage model, honestly.

    python -m relay_ml.evaluate <workspace-id>

Exists so that "the model works" is a number somebody can reproduce rather
than an impression. Three things this does that a naive script would not:

**Reports macro-F1, not accuracy.** Priorities are imbalanced: most of a
real backlog is MEDIUM. A model that answers MEDIUM to everything scores
well on accuracy and is worthless. Macro-F1 averages per class, so ignoring
URGENT entirely costs a quarter of the score.

**Stratifies the split.** With a few hundred rows and four classes, a random
split can leave zero URGENT examples in the test set, and a metric computed
over a class that is not there is undefined rather than good.

**Prints the majority-class baseline next to the model.** A score means
nothing on its own. If the model cannot beat "always answer the most common
label", it has learned nothing and should not ship, and that comparison is
the first thing a reader should see.
"""

from __future__ import annotations

import sys
from collections import Counter

from sklearn.metrics import classification_report, f1_score
from sklearn.model_selection import train_test_split

from .data import load_issues
from .model import MIN_TRAINING_EXAMPLES, Issue, TriageModel, labelled_issues

TEST_FRACTION = 0.25

#: Labelled issues needed before evaluation is even attempted.
#:
#: Not `MIN_TRAINING_EXAMPLES`. The model is fitted on the *training* split,
#: so gating the whole corpus at 40 let 40-53 issues through the door and
#: then watched `fit` decline on the 75% that remained, printing a confusing
#: "declined" after a check that had just passed.
MIN_FOR_EVALUATION = int(MIN_TRAINING_EXAMPLES / (1 - TEST_FRACTION)) + 1

# Fixed, so two runs over the same data are comparable. This is a reporting
# convenience, not a claim that one split is representative -- with a corpus
# this small the honest reading of any single number is "roughly".
RANDOM_STATE = 20_251_008


def evaluate(issues: list[Issue]) -> int:
    # `labelled_issues`, not `if i.priority`. "NONE" is the column default
    # and a truthy string, so the naive filter counted every untriaged issue
    # as a labelled example, put them in the test set, and then scored the
    # model on a class it can never output.
    labelled = labelled_issues(issues)

    if len(labelled) < MIN_FOR_EVALUATION:
        print(
            f"{len(labelled)} issues carry a real priority; need at least "
            f"{MIN_FOR_EVALUATION} so the {int((1 - TEST_FRACTION) * 100)}% training split "
            f"still clears the model's own {MIN_TRAINING_EXAMPLES}-example minimum.\n"
            "Nothing is reported rather than reporting a number from too little data."
        )
        return 1

    counts = Counter(i.priority for i in labelled)

    # `train_test_split` cannot stratify a class with a single member.
    if min(counts.values()) < 2:
        rare = [label for label, n in counts.items() if n < 2]
        print(f"Cannot stratify: {rare} have fewer than 2 examples.")
        return 1

    train, test = train_test_split(
        labelled,
        test_size=TEST_FRACTION,
        random_state=RANDOM_STATE,
        stratify=[i.priority for i in labelled],
    )

    model = TriageModel()
    if not model.fit(train):
        print(f"Model declined to fit on {len(train)} training examples.")
        return 1

    truth = [i.priority for i in test]

    # No `or ("MEDIUM", 0.0)` fallback. Silently turning a failed prediction
    # into a plausible answer is how an evaluation reports a score for a
    # model that is not working.
    predictions = [model.predict(i.text) for i in test]
    if any(p is None for p in predictions):
        raise RuntimeError("model returned no prediction after reporting itself fitted")

    predicted = [p[0] for p in predictions if p is not None]

    # The bar. Answer the most common training label every time.
    majority = Counter(i.priority for i in train).most_common(1)[0][0]
    baseline = [majority] * len(test)

    model_f1 = f1_score(truth, predicted, average="macro", zero_division=0)
    baseline_f1 = f1_score(truth, baseline, average="macro", zero_division=0)

    print(f"train {len(train)}  test {len(test)}  classes {dict(counts)}\n")
    print(classification_report(truth, predicted, zero_division=0))
    print(f"macro-F1   model {model_f1:.3f}   majority-class baseline {baseline_f1:.3f}")

    print(
        f"\nOne {int(TEST_FRACTION * 100)}% split of {len(labelled)} issues, so the test set is "
        f"{len(test)} rows and these figures move by tens of points between seeds.\n"
        "Read them as 'roughly', not as a benchmark."
    )

    if model_f1 <= baseline_f1:
        # Non-zero, so a CI step or a promotion gate fails on this rather
        # than printing a warning into a log nobody reads.
        print("\nThe model does not beat the baseline. It has learned nothing useful here.")
        return 1

    return 0


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python -m relay_ml.evaluate <workspace-id>")
        return 2

    return evaluate(load_issues(sys.argv[1]))


if __name__ == "__main__":
    raise SystemExit(main())
