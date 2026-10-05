"""ProgressReporter (E2): writes ingestion stage transitions to ingestion_jobs.

The pymongo collection is a MagicMock, so no MongoDB is needed; the tests assert
on the find_one_and_update call arguments the reporter makes.
"""

from unittest.mock import MagicMock

from bson import ObjectId

from app.pipeline.progress import ProgressReporter

DOC_ID = "6abb28ae16068a0793e9962a"


def last_set(collection):
    """The $set payload of the most recent find_one_and_update call."""
    _, kwargs = collection.find_one_and_update.call_args
    args = collection.find_one_and_update.call_args.args
    # Support both positional (filter, update) and keyword forms.
    update = kwargs.get("update", args[1] if len(args) > 1 else None)
    return update["$set"]


def last_filter(collection):
    args = collection.find_one_and_update.call_args.args
    kwargs = collection.find_one_and_update.call_args.kwargs
    return kwargs.get("filter", args[0] if args else None)


def test_start_stage_sets_current_stage_and_started_at_with_empty_log():
    collection = MagicMock()
    reporter = ProgressReporter(collection, DOC_ID)

    reporter.start_stage("parsing")

    assert collection.find_one_and_update.call_count == 1
    assert last_filter(collection) == {"documentId": ObjectId(DOC_ID)}
    update = last_set(collection)
    assert update["currentStage"] == "parsing"
    assert "startedAt" in update
    assert "currentStageStartedAt" in update
    assert "updatedAt" in update
    # First stage: nothing has completed yet.
    assert update.get("stageLog", []) == []


def test_second_start_stage_appends_the_first_to_the_log_with_a_duration():
    collection = MagicMock()
    reporter = ProgressReporter(collection, DOC_ID)

    reporter.start_stage("parsing")
    reporter.start_stage("chunking")

    update = last_set(collection)
    assert update["currentStage"] == "chunking"
    assert len(update["stageLog"]) == 1
    logged = update["stageLog"][0]
    assert logged["stage"] == "parsing"
    assert logged["durationMs"] >= 0
    assert "startedAt" in logged


def test_update_pages_sets_only_page_fields():
    collection = MagicMock()
    reporter = ProgressReporter(collection, DOC_ID)
    reporter.start_stage("chunking")
    collection.find_one_and_update.reset_mock()

    reporter.update_pages(12, 45)

    update = last_set(collection)
    assert update["pageCurrent"] == 12
    assert update["pageTotal"] == 45
    assert "currentStage" not in update


def test_finish_moves_the_current_stage_to_the_log():
    collection = MagicMock()
    reporter = ProgressReporter(collection, DOC_ID)
    reporter.start_stage("indexing")
    collection.find_one_and_update.reset_mock()

    reporter.finish()

    update = last_set(collection)
    assert len(update["stageLog"]) == 1
    assert update["stageLog"][0]["stage"] == "indexing"
    assert update["stageLog"][0]["durationMs"] >= 0


def test_every_method_is_a_no_op_without_a_document_id():
    collection = MagicMock()
    reporter = ProgressReporter(collection, None)

    reporter.start_stage("parsing")
    reporter.update_pages(12, 45)
    reporter.finish()

    collection.find_one_and_update.assert_not_called()

