-- What the ML service may read (stage 1, item 8): the issue fields its
-- duplicate and priority models use, and nothing else. Owned by the
-- migrations, so the service's role reads it with the owner's rights and
-- needs no grant on `issues` itself; a column added to `issues` stays out
-- of the ML service's reach until it is added here on purpose.
CREATE VIEW "ml_issues" AS
SELECT "id", "workspace_id", "title", "description", "priority", "created_at", "updated_at"
FROM "issues";
