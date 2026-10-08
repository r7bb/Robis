"""Reading issues out of Relay's database.

This service is a *reader*. It opens its own connection, selects, and never
writes: the schema belongs to ``backend/database`` and is owned by the
migrations there. Giving the ML service write access would make it a second
author of the same tables with no migration story of its own, which is how
two services end up disagreeing about a column.

In a deployment this should be a read-only role. The query below is scoped
by workspace because every model here is per-tenant: issues from one
workspace must never inform a suggestion shown in another, and the cleanest
way to guarantee that is to never load them together.
"""

from __future__ import annotations

import os

import psycopg

from .model import Issue

DEFAULT_DATABASE_URL = "postgres://relay:relay@localhost:5433/relay"


#: Fail rather than hang. Without this a stalled database holds the
#: connection attempt open indefinitely and takes a request thread with it.
CONNECT_TIMEOUT_SECONDS = 5


def database_url() -> str:
    return os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)


def _connect(url: str | None) -> psycopg.Connection:
    """A read-only connection, enforced by the server rather than by habit.

    `default_transaction_read_only` means a stray INSERT in this package is
    an error from Postgres, not a silent second writer to tables owned by
    `backend/database` and its migrations. In a deployment the role should
    be read-only too; this is the belt to that's braces.
    """
    return psycopg.connect(
        url or database_url(),
        connect_timeout=CONNECT_TIMEOUT_SECONDS,
        options="-c default_transaction_read_only=on",
    )


def load_issues(workspace_id: str, url: str | None = None) -> list[Issue]:
    """Every issue in one workspace.

    Parameterised rather than interpolated. ``workspace_id`` arrives from an
    HTTP request, and a formatted string here would be SQL injection in a
    service that holds a database credential.
    """
    query = """
        select id::text, title, description, priority::text
        from issues
        where workspace_id = %s::uuid
        order by created_at
    """

    with _connect(url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, (workspace_id,))
            rows = cursor.fetchall()

    return [Issue(id=row[0], title=row[1], description=row[2], priority=row[3]) for row in rows]


def corpus_fingerprint(workspace_id: str, url: str | None = None) -> tuple[int, str]:
    """A cheap summary of a workspace's issues: how many, and newest change.

    This exists so the service can tell whether a cached model still
    describes reality. That was previously answered by a five-minute timer,
    which meant an issue filed thirty seconds ago was invisible to duplicate
    detection -- the exact moment somebody is most likely to file the same
    thing twice.

    Count and max together rather than either alone: a count misses an edit
    to an existing title, and a max misses a deletion. Both are served from
    the `(workspace_id, ...)` index without reading a row, so this is far
    cheaper than the load and fit it avoids.
    """
    query = """
        select count(*), coalesce(max(updated_at)::text, '')
        from issues
        where workspace_id = %s::uuid
    """

    with _connect(url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, (workspace_id,))
            row = cursor.fetchone()

    return (int(row[0]), str(row[1])) if row else (0, "")


def workspace_ids(url: str | None = None) -> list[str]:
    """Every workspace that has at least one issue, for warming caches."""
    with _connect(url) as connection:
        with connection.cursor() as cursor:
            cursor.execute("select distinct workspace_id::text from issues")
            return [row[0] for row in cursor.fetchall()]
