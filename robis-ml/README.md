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

.venv/bin/python -m pytest                    # 95 tests

# local only; anywhere else, set ROBIS_ML_TOKEN instead
ROBIS_ML_ALLOW_ANONYMOUS=1 .venv/bin/python -m uvicorn robis_ml.service:app --port 8000
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
This is the strongest argument for sentence embeddings, and the measurement
below now puts a number on it.

### Measured against a labelled set

```bash
.venv/bin/python -m robis_ml.duplicate_eval
```

No database needed. The labelled set is
[`robis_ml/datasets/duplicates.json`](robis_ml/datasets/duplicates.json):

- **Corpus:** 40 issues, the 10 seeded titles verbatim (a test checks them
  against `scripts/db/seed.ts`) plus 30 written in Robis's own domain.
- **Queries:** 84 bare titles, as somebody types them into the composer:
  - 34 paraphrases
  - 14 lexical gaps: same intent, almost no shared words
  - 22 hard negatives: shared words, different intent
  - 14 unrelated

Each query is scored the way the composer shows it: a bare title embedded
with `compose_text`, cut at the threshold, then at the three hints the API
keeps. Tests check that this matches `DuplicateFinder.query` result for
result. Other tests read the API's own display limit and score floor from
`backend/api/src/suggestions.ts`, so the evaluation cannot drift from what
reaches the screen.
Precision counts hints shown. Recall counts duplicate pairs. A false alarm is
a query with no duplicate that still gets a hint, counted once per query.
These are different denominators and are never combined into one number.

**The threshold is chosen on one half and reported on the other.** Every
query was put in `dev` or `test` when it was written, before any score
existed. The rule was fixed in advance too: the best pair F1 on dev, with
ties going to the stricter threshold. F1 is a neutral default here, not a
rule derived from the product.

That rule picks **0.40**, which is now the default. On the test half, with
Wilson 95% intervals:

| At 0.40, test half | Rate | 95% interval | Count |
| --- | --- | --- | --- |
| Precision | 0.79 | 0.57–0.91 | 15 / 19 hints |
| Recall | 0.62 | 0.43–0.79 | 15 / 24 pairs |
| Recall, paraphrases | 0.88 | 0.66–0.97 | 15 / 17 |
| **Recall, lexical gaps** | **0.00** | 0.00–0.35 | 0 / 7 |
| False alarms, hard negatives | 0.36 | 0.15–0.65 | 4 / 11 queries |
| False alarms, unrelated | 0.00 | 0.00–0.35 | 0 / 7 queries |

The split holds out *queries*, not *issues*. Both halves search the same
corpus, as production does, and 5 corpus issues are the target of a query in
each half. There is no single false-alarm rate worth quoting, because the
overall figure (4 of 18) depends on how many hard negatives the set's author
chose to write.

The full dev sweep, for anybody who wants to argue for a different rule:

| Threshold | Precision | Recall | F1 | False alarms |
| --- | --- | --- | --- | --- |
| 0.25 | 0.53 | 0.67 | 0.59 | 0.33 |
| 0.30 | 0.54 | 0.58 | 0.56 | 0.33 |
| 0.35 | 0.68 | 0.54 | 0.60 | 0.22 |
| **0.40** | 0.72 | 0.54 | **0.62** | 0.22 |
| 0.45 | 0.79 | 0.46 | 0.58 | 0.17 |
| 0.50 | 0.91 | 0.42 | 0.57 | 0.06 |
| 0.55 | 1.00 | 0.33 | 0.50 | 0.00 |

A hint is advisory and cheap to ignore, but an unwanted one still costs
attention. A rule that capped false alarms first would land nearer 0.50.
That is a reasonable product choice. It was not the rule fixed in advance,
so it is not the default.

What this does and does not show:

- **When the words overlap, it mostly works. When they don't, it found
  nothing.** It caught 15 of 17 paraphrases and none of the 7 lexical-gap
  duplicates. Dropping to 0.20 finds 1 of 7, at the cost of an unwanted hint
  on more than half of the queries that have no duplicate. The missing
  stemming is a plausible cause, but that has not been tested.
- **Shared vocabulary causes the false alarms.** Every false alarm came from
  a hard negative, such as "Rate limit the search endpoint" matching "Rate
  limit the auth endpoints". None came from an unrelated title.
- **0.40 is not shown to be better than the old 0.35.** It was chosen on dev
  under the rule fixed in advance, and the test half did not confirm it. Dev
  preferred 0.40 by 0.02 F1. Test preferred 0.35 by 0.04 (0.74 against
  0.70), which is two pairs and one false alarm. Both gaps are inside the
  noise. The threshold was not re-picked on test, because that would make
  the test numbers meaningless. Now that test has been seen, any further
  change to the threshold is exploratory.
- **This is not an independent benchmark.** The same person wrote the set
  and the model. They chose the split before seeing any score, but they knew
  how TF-IDF behaves. The intervals are wide because the set is small.
- **It measures title-only matching on clean titles.** Ten corpus issues are
  seed titles with no description. Real issues have descriptions, typos and
  vocabulary nobody anticipated. These numbers are not a prediction of how
  it does in a real workspace.

A test asserts that `DEFAULT_DUPLICATE_THRESHOLD` still equals the dev
choice. If the data or the model changes and the best threshold moves, the
suite fails, so the constant cannot quietly go back to being a guess. The
same command will judge an embedding model, and lexical-gap recall is the
number to beat.

### Character n-grams do not close the gap

```bash
.venv/bin/python -m robis_ml.duplicate_eval --compare
```

The roadmap set the question before anything was run: adopt a representation
only if lexical-gap recall rises *without* hard-negative false alarms rising
with it. Five representations were fixed in advance, in `REPRESENTATIONS`:
the current word TF-IDF, character n-grams (`char_wb`, 3–5 and 2–4), and each
of those combined with the word features. Each one is held to its own
best-F1 threshold on dev.

| Representation | Gap recall, dev | Gap recall, test\* | Hard-negative false alarms, dev / test\* |
| --- | --- | --- | --- |
| word 1–2 (current) | 0 / 7 | 0 / 7 | 4 / 11, 4 / 11 |
| char_wb 3–5 | 0 / 7 | 0 / 7 | 2 / 11, 2 / 11 |
| char_wb 2–4 | **3 / 7** | 0 / 7 | 5 / 11, 6 / 11 |
| word + char_wb 3–5 | 0 / 7 | 0 / 7 | 4 / 11, 2 / 11 |
| word + char_wb 2–4 | 0 / 7 | 0 / 7 | 4 / 11, 3 / 11 |

\* The test half was read when the threshold above was reported, so it is no
longer untouched. Here it shows only whether a dev difference survives. It
cannot confirm one.

**None of them meets the rule, so production stays on word TF-IDF.** The one
dev gain was `char_wb 2-4` finding 3 gaps. Hard-negative false alarms rose
with it, so it fails the rule on dev alone, before test is consulted.

Two caveats on how this was run:

- **Thresholds were picked by F1, not by the rule.** Each representation is
  held to its own best-F1 threshold on dev, and the adopt-or-not rule is then
  read off the result at that threshold.
- **Five representations against one small set has a multiplicity cost.**
  The test half had also been seen once already.

**One thing the set cannot answer.** Sorting the 14 gap queries by hand,
after the fact:

- **4 are word forms of the target's words.** "authentication" against
  "auth", "paging" against "pagination", "authenticator" against
  "authentication", "attachment" against "attachments". By the set's own
  definition ("almost no shared content words"), these are borderline, and
  arguably paraphrases.
- **The other 10 are synonyms.** "night" against "dark", "throttle" against
  "rate limit", "RAM" against "memory", "GMT" against "timezone", and so on.
  These share no characters.

All 4 word-form queries happened to land in the dev half. That imbalance was
not noticed when the set was written, and it may explain on its own why the
dev gain vanished on test, since test has no word-form gap to find. The 3 dev
hits were among those 4. That fits sub-word pieces bridging word forms, but
with 3 queries it is a hypothesis, not a mechanism. Overlap at a loose 0.40
threshold would explain it too.

What this does **not** show:

- That character n-grams fail in general. The claim is only about this small,
  author-written set, whose 40-issue corpus gives IDF weights that will not
  carry over to a real workspace.
- Anything about stemming. It was not tried, because it needs a new
  dependency, and the reading above predicts it could help with word forms.
- That embeddings would fix the synonym kind. That is the next experiment,
  not a finding.

**A side result, not adopted.** `char_wb 3-5` alone had fewer hard-negative
false alarms than the current model: 2 of 11 against 4 of 11, on both halves.
That is two queries, with heavily overlapping intervals. The combined
variants do not show it on dev. It was not the question asked, so it is an
unconfirmed candidate to re-test on a set somebody else writes, not a change.

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

`DuplicateFinder` is measured separately, against a labelled set rather than
a workspace. See [Measured against a labelled set](#measured-against-a-labelled-set).

## Multi-tenancy, and what is not protected

Models are fitted and cached **per workspace**. Issues from one workspace never
enter another's vectorizer or training set. `data.py` takes a workspace id and
scopes its query by it; there is no code path that loads two workspaces into
one model. The query is parameterised, and the connection is opened
`default_transaction_read_only` so a stray write in this package is an error
from Postgres rather than a silent second writer to tables owned by
`backend/database`.

**Every endpoint except `/health` needs a bearer token.** The service reads it
from `ROBIS_ML_TOKEN` and refuses to start without one; the API sends the same
value as `ML_SERVICE_TOKEN`. Tokens are compared with `hmac.compare_digest`.
For local work against seeded data, `ROBIS_ML_ALLOW_ANONYMOUS=1` turns the check
off, and has to be set on purpose so that a forgotten variable fails closed.

The token says the caller is Robis's API, not which user is asking. The API has
already checked workspace membership before it calls here, and a non-member
gets 404 without the service being called at all.

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
  model.py           DuplicateFinder, TriageModel, compose_text, the vectorizer
  data.py            read-only Postgres loader, scoped by workspace
  evaluate.py        triage: repeated stratified k-fold against a baseline
  duplicate_eval.py  duplicates: precision and recall on the labelled set
  datasets/          the labelled duplicate set
  service.py         FastAPI: /health, /similar, /triage
  auth.py            shared bearer token
tests/
  test_model.py          17 tests, in-memory, no database
  test_service.py        18 tests: auth, tenant isolation, cache
  test_duplicate_eval.py 60 tests: metrics, set integrity, threshold, comparison
```

`compose_text` is shared by the corpus and the query on purpose. They were two
implementations that happened to agree, which is train/serve skew waiting for
somebody to edit one of them.
