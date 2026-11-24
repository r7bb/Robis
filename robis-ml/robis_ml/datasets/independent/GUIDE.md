# Writing the independent duplicate set

Thank you for writing this. It measures how well Robis spots an issue that
has already been filed. The set it replaces was written by the person who
built the model, so it cannot be trusted to judge the model. Yours can, as
long as you write it **without looking at the model, its scores, or the old
set** (`../duplicates.json`). Please do not run anything in `robis_ml` while
writing, apart from the check at the end.

It takes about an hour. You fill in one file, `independent.json`, starting
from `template.json` in this folder.

## The idea

Picture a team using an issue tracker for a software product. You write
two things:

1. **Issues already filed** (the corpus): 40 short issue titles, each with a
   topic, as a team would file them. Optionally a one-line description.
2. **Titles someone is about to file** (the queries): 120 new titles, each
   either a repeat of an issue above, or not.

A query is a **duplicate** when fixing the filed issue would also settle the
query: the same problem or the same request, even in different words. It is
**not** a duplicate when it is about a different thing, even if it uses the
same words.

## The five kinds of query, and how many of each

The examples here are from a cooking app on purpose, so they do not steer
your wording. Write yours about a software team's work.

| Kind | How many | What it is | Example (filed → query) |
| --- | --- | --- | --- |
| `word_form` | 25 | A duplicate that uses other forms of the same words: plural, tense, -ing, abbreviation | "Timer stops when screen locks" → "Timers stopping after locking the screen" |
| `synonym` | 25 | A duplicate that swaps some words for words meaning the same | "Timer stops when screen locks" → "Countdown halts when the display sleeps" |
| `lexical_gap` | 20 | A duplicate that shares almost no words at all | "Timer stops when screen locks" → "My pasta overcooked because the alarm never rang with the phone asleep" |
| `hard_negative` | 30 | Not a duplicate, but shares words with a filed issue | "Timer stops when screen locks" → "Add a second timer for the oven" |
| `unrelated` | 20 | Not a duplicate, and about something else | "Export my shopping list as a PDF" |

Some guidance:

- Write queries as someone would type them into a "new issue" box: one
  line, no full stops needed, the way people really write ("login broken
  on safari again").
- Spread the duplicates across the 40 issues. No issue needs more than six
  queries pointing at it, and most should have at least one.
- A duplicate query may point at two issues if it truly repeats both.
- Give every query a `topic` from the same list you used for the corpus.
  For a duplicate, that is the topic of the issue it repeats; for a
  non-duplicate, the topic it is closest to.
- Use 6 to 10 topics, each with several issues (for example: sign in,
  billing, notifications, search, mobile app, performance, permissions,
  exports).
- Do not include names of real people, real email addresses or anything
  private.

## The format

Each corpus issue: `id` (c01 to c40), `title`, `topic`, and optionally
`description`.

Each query: `id` (q001 to q120), `title`, `kind` (one of the five above),
`topic`, and `duplicates` (a list of corpus ids; empty for `hard_negative`
and `unrelated`).

Set `author` to how you would like to be credited (a name, or "a second
author" if you prefer), and `written` to the date.

Do **not** add a dev or test split: that is assigned afterwards by a seeded
script and committed before any score is computed.

## When you are done

Run the check. It says only whether the file is well formed and how many
of each kind it holds; it never runs the model:

```bash
cd robis-ml
.venv/bin/python -m robis_ml.independent_eval check
```

Then hand the file back. The split is fixed with `split`, committed, and
only then is `report` run, once.
