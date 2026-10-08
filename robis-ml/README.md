# robis-ml

Two models over the text of Robis issues: **find possible duplicates**, and
**suggest a priority**.

Both are advisory. Nothing in Robis changes a priority or closes an issue on
the strength of a prediction. Every response carries its score so the caller
can disagree.

```bash
cd robis-ml
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -e ".[dev]"

.venv/bin/python -m pytest                    # 17 tests
.venv/bin/python -m uvicorn robis_ml.service:app --port 8000
```

## Possible duplicates

Nearest neighbours in TF-IDF space. Unsupervised, so it works the moment a
workspace has two issues in it.

```bash
curl -X POST localhost:8000/workspaces/$WORKSPACE/similar \
  -H 'content-type: application/json' \
  -d '{"title":"Throttle the auth endpoints against brute force"}'
```

```json
{
  "similar": [{ "id": "cd95855c…", "title": "Rate limit the auth endpoints", "score": 0.6389 }],
  "corpus_size": 13,
  "model_age_seconds": 0
}
```

### Where it falls down

Those numbers are from the seeded corpus in this repository. They are an
illustration, not a benchmark, and one of them shows the method's limit
clearly:

| Query                                            | Best match                     | Score  |
| ------------------------------------------------ | ------------------------------ | ------ |
| "Throttle the **auth** endpoints against brute force" | "Rate limit the auth endpoints" | 0.6389 |
| "Throttle the **authentication** endpoints"           | "Rate limit the auth endpoints" | 0.2608 |

Same intent, same best match, less than half the score, because `auth` and
`authentication` are different tokens and TF-IDF has no idea they are related.
This is the strongest argument for sentence embeddings, and it is why
`evaluate.py` exists: so that swap can be judged on numbers rather than on
taste.

**There is no precision or recall figure for this model.** That would need a
labelled set of true duplicate pairs, which does not exist here. Until it
does, this is not a validated model, and the 0.35 default threshold is a
product guess tuned by eye, not a learned one.

## Priority triage

Multinomial logistic regression over the same features. Linear and
probabilistic on purpose: the coefficients are inspectable, so when it says
`URGENT` somebody can ask which words did that. For a suggestion a human
overrides, that matters more than another point of accuracy.

```json
{
  "priority": null,
  "score": null,
  "reason": "only 9 issues in this workspace carry a real priority; at least 40 are needed before a suggestion means anything",
  "trained_on": 9,
  "model_age_seconds": 0
}
```

**The refusal is the feature.** A classifier fitted on nine issues will still
return a label and a confident-looking probability, and that number is worse
than no answer because it invites somebody to trust it.

Two things that field is *not*:

- It is called `score`, not `confidence`. It is an uncalibrated softmax from a
  regularised model trained with `class_weight="balanced"`, which deliberately
  shifts probabilities away from the real class priors. Nothing here measures
  calibration. Treat it as a ranking signal, not as "87% sure".
- `NONE` is not a class. It is Robis's column default and means "nobody has
  triaged this", so it is excluded from training and from evaluation. This was
  a real bug: `if issue.priority` is true for the string `"NONE"`, which
  counted every untriaged issue as a labelled example and then scored the model
  on a class it can never output.

## Why TF-IDF and not embeddings

1. **The corpus suits it.** One workspace's issues are short, few, and full of
   shared project vocabulary. That favours lexical matching and disadvantages a
   general-purpose embedding model that has seen none of it.
2. **It costs nothing.** Fits in milliseconds. No GPU, no warm-up, no weights
   to ship or version.
3. **Weights could not be downloaded here.** `cdn-lfs.huggingface.co` is
   unreachable in the environment this was built in, so a transformer baseline
   could not have been measured even for comparison.

The third is a constraint, not a justification, and it is written down so
nobody mistakes this for a considered rejection of embeddings.

## Measuring it

```bash
.venv/bin/python -m robis_ml.evaluate <workspace-id>
```

Reports **macro-F1 over 5-fold stratified cross-validation, repeated 5 times**,
against a stratified-random baseline, plus a time-ordered holdout and a Brier
score. Exits non-zero unless the model clears the baseline by a margin.

Four deliberate choices:

- **Repeated k-fold, not one split.** A single holdout gives a number that
  moves by tens of points with the seed. Measured on a noise corpus, one run
  ranged from 0.155 to 0.448. The spread is the honest half of the result.
- **Macro-F1, not accuracy.** A real backlog is mostly `MEDIUM`, and a model
  that answers `MEDIUM` to everything scores well on accuracy while being
  worthless.
- **A stratified-random baseline, and a margin.** The obvious baseline,
  always answering the most common label, is far too weak: it scores near
  zero on macro-F1 by construction. Against a corpus of *random labels* the
  model scored 0.259 to that baseline's 0.193 and a bare "greater than" let
  it through as a pass. It had learned nothing; it just spread its guesses
  across three classes while the degenerate baseline put everything in one.
  Guessing in proportion to the class frequencies is what a signal-free
  model actually does, so beating *that* means something. It now scores
  0.259 against 0.296 on noise, and correctly fails.
- **A time-ordered holdout as well.** The random folds are optimistic here:
  the corpus is full of paraphrases, so a near-duplicate can sit in train
  while its twin sits in test. Training on the oldest and testing on the
  newest is what production looks like.

**No evaluation numbers are published here.** The seeded workspace has nine
triaged issues, which is below the threshold to fit at all. Quoting a metric
computed on nine rows would be the dishonest part of this module.

Still missing: `DuplicateFinder` has no precision or recall figure, because
no labelled set of true duplicate pairs exists. Until one does, it is not a
validated model and the 0.35 threshold remains a guess tuned by eye.

## Multi-tenancy, and what is not protected

Models are fitted and cached **per workspace**. Issues from one workspace never
enter another's vectorizer or training set. `data.py` takes a workspace id and
scopes its query by it; there is no code path that loads two workspaces into
one model. The query is parameterised, and the connection is opened
`default_transaction_read_only` so a stray write in this package is an error
from Postgres rather than a silent second writer to tables owned by
`backend/database`.

**The service itself is unauthenticated.** It takes a workspace id from the URL
and trusts it. Anyone who can reach the port and knows a workspace UUID can
read issue titles from it. That is acceptable only because it is not deployed
and not wired into the API; before it is either, it needs a service credential
or an internal-only bind. This is the top item on its roadmap.

## Staleness

A cached model is reused only while the workspace still matches the
`(count, max(updated_at))` fingerprint it was fitted against. That check runs
on every request and costs an indexed count, far less than the load and fit it
avoids, so an issue filed thirty seconds ago is findable immediately.

This replaced a five-minute TTL, which left a new issue invisible to duplicate
detection for five minutes -- the exact moment somebody is most likely to file
the same thing twice. A 15-minute TTL remains as a backstop for anything the
fingerprint cannot see, and responses still carry `model_age_seconds`.

If the fingerprint lookup fails, the cached model is served rather than the
request failing: being unable to check freshness is not a reason to stop
answering.

## Layout

```
robis_ml/
  model.py      DuplicateFinder, TriageModel, compose_text, the vectorizer
  data.py       read-only Postgres loader, scoped by workspace
  evaluate.py   stratified split, macro-F1 vs baseline
  service.py    FastAPI: /health, /similar, /triage
tests/
  test_model.py 17 tests, in-memory, no database
```

`compose_text` is shared by the corpus and the query on purpose. They were two
implementations that happened to agree, which is train/serve skew waiting for
somebody to edit one of them.
