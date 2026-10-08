"""Service-to-service authentication.

This service answers questions about one workspace's issues, and it takes
the workspace id from the URL. Without a credential that makes it an open
read endpoint for anybody who can reach the port and guess a UUID, which is
why nothing was allowed to call it until this existed.

A shared bearer token rather than anything cleverer. The only caller is
Relay's own API, over a private network, so there is no third party to
federate with and no user identity to carry: the API has already decided
that *this user* may read *this workspace* before it asks anything here.
Adding OAuth or mTLS would be protecting a different threat model than the
one that applies.
"""

from __future__ import annotations

import hmac
import os
from typing import Annotated

from fastapi import Header, HTTPException

#: The shared secret, read from the environment.
TOKEN_ENV = "RELAY_ML_TOKEN"

#: Explicit opt-out, for running the service locally against seeded data.
#:
#: A flag rather than "no token means no auth", because that default fails
#: open: forgetting to set the variable in a deployment would silently
#: publish the endpoints. This way the quiet path is the safe one and
#: anybody turning it off has to say so.
ALLOW_ANONYMOUS_ENV = "RELAY_ML_ALLOW_ANONYMOUS"


def _configured_token() -> str | None:
    token = os.environ.get(TOKEN_ENV, "").strip()
    return token or None


def anonymous_allowed() -> bool:
    return os.environ.get(ALLOW_ANONYMOUS_ENV, "").strip() == "1"


def check_configuration() -> None:
    """Refuse to start unconfigured, rather than starting unprotected.

    The same shape as the API's refusal to boot in production without a mail
    driver. Failing loudly at startup with an explanation beats serving an
    unauthenticated endpoint that nobody notices for a month.
    """
    if _configured_token() or anonymous_allowed():
        return

    raise RuntimeError(
        "\n".join(
            [
                f"Refusing to start: {TOKEN_ENV} is not set.",
                "",
                "This service returns issue titles for whatever workspace id is",
                "in the URL. Without a token it is an open read endpoint for",
                "anybody who can reach the port.",
                "",
                f"Set {TOKEN_ENV} to a shared secret, and send it as",
                "'Authorization: Bearer <token>'.",
                "",
                "For local experimentation against seeded data, set",
                f"{ALLOW_ANONYMOUS_ENV}=1 instead. Never do that anywhere real.",
            ]
        )
    )


def require_service_token(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """FastAPI dependency. Raises 401 unless the caller presents the token."""
    expected = _configured_token()

    # Checked per request rather than once at import, so flipping the
    # variable does not leave a stale decision behind in a reloaded worker.
    if expected is None:
        if anonymous_allowed():
            return
        # Unreachable if `check_configuration` ran, and a closed failure if
        # somehow it did not.
        raise HTTPException(status_code=503, detail="service is not configured")

    scheme, _, presented = (authorization or "").partition(" ")

    if scheme.lower() != "bearer" or not presented:
        raise HTTPException(
            status_code=401,
            detail="expected an Authorization: Bearer header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # `compare_digest` rather than `==`: a short-circuiting comparison leaks
    # how many leading bytes were right, which is enough to recover a token
    # one byte at a time.
    if not hmac.compare_digest(presented, expected):
        raise HTTPException(
            status_code=401,
            detail="invalid service token",
            headers={"WWW-Authenticate": "Bearer"},
        )
