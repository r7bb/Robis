"""Duplicate detection and priority triage for Robis issues.

Only the model layer is re-exported here. ``data`` and ``service`` are not,
because importing this package should not require a database driver or a
web framework to be installed -- the tests exercise the models alone.
"""

from .model import (
    DEFAULT_DUPLICATE_THRESHOLD,
    MIN_TRAINING_EXAMPLES,
    PRIORITIES,
    UNTRIAGED,
    DuplicateFinder,
    Issue,
    Similar,
    TriageModel,
    compose_text,
    labelled_issues,
)

__all__ = [
    "DEFAULT_DUPLICATE_THRESHOLD",
    "MIN_TRAINING_EXAMPLES",
    "PRIORITIES",
    "UNTRIAGED",
    "DuplicateFinder",
    "Issue",
    "Similar",
    "TriageModel",
    "compose_text",
    "labelled_issues",
]
