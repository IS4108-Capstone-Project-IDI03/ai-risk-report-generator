"""Ingestion progress reporting (E2).

`ProgressReporter` writes one `ingestion_jobs` document per run, keyed by
`documentId`, as the pipeline moves through its stages. The gateway reads this
row to enrich the knowledge-document DTO while a document is `processing`
(see server/src/services/ingestion-job.service.ts).

The worker constructs one reporter per job and threads it through the pipeline.
Every write is an upsert on `{documentId}`, so a crashed-and-restarted worker
resumes cleanly rather than failing on a missing row.

`NoOpReporter` has the same interface but does nothing, so the pipeline can call
`reporter.start_stage(...)` unconditionally when no MongoDB is available (CLI or
tests). Passing `document_id=None` to `ProgressReporter` makes it a no-op too.
"""

from datetime import UTC, datetime

from bson import ObjectId


class ProgressReporter:
    """Records stage transitions and chunk progress for one ingestion run."""

    def __init__(self, collection, document_id: str | None) -> None:
        """Create a reporter.

        Args:
            collection: the pymongo `ingestion_jobs` collection.
            document_id: the knowledge document's string ObjectId. Pass ``None``
                to make every method a no-op (CLI/test usage without MongoDB).
        """
        self._collection = collection
        self._doc_id = document_id
        # The stage currently in progress and when it began; completed stages
        # accumulate in _stage_log. Elapsed time is computed from these without
        # a read back from MongoDB.
        self._current_stage: str | None = None
        self._stage_started_at: datetime | None = None
        self._started_at: datetime | None = None
        self._stage_log: list[dict] = []

    def _enabled(self) -> bool:
        return self._doc_id is not None

    def _write(self, extra: dict, *, unset: dict | None = None) -> None:
        """Upsert the job document with `extra` merged into the common fields."""
        now = datetime.now(UTC)
        update: dict = {"$set": {"updatedAt": now, **extra}}
        if unset:
            update["$unset"] = unset
        self._collection.find_one_and_update(
            {"documentId": ObjectId(self._doc_id)},
            update,
            upsert=True,
        )

    def _close_current_stage(self, now: datetime) -> None:
        """Append the stage in progress (if any) to the completed-stage log."""
        if self._current_stage is None or self._stage_started_at is None:
            return
        duration_ms = int((now - self._stage_started_at).total_seconds() * 1000)
        self._stage_log.append(
            {
                "stage": self._current_stage,
                "startedAt": self._stage_started_at,
                "durationMs": duration_ms,
            }
        )

    @property
    def current_stage(self) -> str | None:
        """The stage in progress, or None once finished / not yet started.

        The worker reads this in its failure handler — before it appends the
        'failed' sentinel — to learn which real stage broke, for the admin's
        notification (IN-10).
        """
        return self._current_stage

    def start_stage(self, stage: str) -> None:
        """Transition to a new stage.

        Appends the previous stage (with its duration) to the stage log, sets
        the new current stage and its start time, and on the first call records
        the overall job start.
        """
        if not self._enabled():
            return
        now = datetime.now(UTC)
        self._close_current_stage(now)
        self._current_stage = stage
        self._stage_started_at = now
        if self._started_at is None:
            self._started_at = now
        self._write(
            {
                "currentStage": stage,
                "currentStageStartedAt": now,
                "startedAt": self._started_at,
                "stageLog": list(self._stage_log),
            }
        )

    def update_pages(self, current: int, total: int | None) -> None:
        """Update the page counter only, with no stage transition (E2b).

        `current` is the page being chunked; `total` is the document's page
        count (known up front from the parser). The chunk count has no knowable
        total, so progress is tracked by page instead.
        """
        if not self._enabled():
            return
        self._write({"pageCurrent": current, "pageTotal": total})

    def finish(self) -> None:
        """Move the current stage to the stage log and clear it.

        Unsets `currentStage`/`currentStageStartedAt` on the stored document so
        the gateway stops reporting progress once a run is finished.
        """
        if not self._enabled():
            return
        now = datetime.now(UTC)
        self._close_current_stage(now)
        self._current_stage = None
        self._stage_started_at = None
        self._write(
            {"stageLog": list(self._stage_log)},
            unset={"currentStage": "", "currentStageStartedAt": ""},
        )


class NoOpReporter:
    """A ProgressReporter-shaped object whose methods do nothing.

    Lets the pipeline call reporter methods unconditionally when no reporter was
    supplied (CLI/batch/test), avoiding `if reporter:` guards throughout.
    """

    def start_stage(self, stage: str) -> None:
        pass

    def update_pages(self, current: int, total: int | None) -> None:
        pass

    def finish(self) -> None:
        pass
