"""Ingestion → gateway notifications (IN-10).

The worker tells the gateway when a document finishes or fails ingesting, by
posting to the internal notification endpoint with the shared service key. The
HTTP client is faked, so no gateway is needed. Posting must never break
ingestion: a gateway error is swallowed after the status has been recorded.
"""

from datetime import datetime

import pytest
from bson import ObjectId

from app import notifications

DOC_ID = "6abb28ae16068a0793e9962a"


def make_doc(**overrides):
    doc = {
        "_id": ObjectId(DOC_ID),
        "title": "NFPA 13 sprinkler standard",
        "fileName": "NFPA 13 - 2022.pdf",
        "metadata": {
            "source_type": "marsh_report",
            "jurisdiction": "MY",
            "facility_type": "Cold store",
            "effective_date": datetime(2024, 3, 12),
        },
    }
    doc.update(overrides)
    return doc


class FakePost:
    """Records the one HTTP POST the notifier makes, and can be set to fail."""

    def __init__(self, raise_error=None, status=201):
        self.raise_error = raise_error
        self.status = status
        self.calls = []

    def __call__(self, url, *, json, headers, timeout):
        self.calls.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
        if self.raise_error is not None:
            raise self.raise_error
        return _FakeResponse(self.status)


class _FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code


@pytest.fixture(autouse=True)
def service_env(monkeypatch):
    monkeypatch.setenv("GATEWAY_URL", "http://gateway:4000")
    monkeypatch.setenv("SERVICE_API_KEY", "test-key")


def test_a_complete_document_posts_a_finished_notification(monkeypatch):
    post = FakePost()
    monkeypatch.setattr(notifications.httpx, "post", post)

    notifications.notify_ingestion(make_doc(), status="complete")

    assert len(post.calls) == 1
    call = post.calls[0]
    assert call["url"] == "http://gateway:4000/api/internal/notifications"
    assert call["headers"]["x-service-key"] == "test-key"
    body = call["json"]
    assert body["purpose"] == "ingestion_status"
    assert body["targetRole"] == "knowledge_admin"
    assert body["targetUserIds"] == ["all"]
    assert body["createdByService"] == "ingestion-service"
    assert "NFPA 13 sprinkler standard" in body["message"]
    assert "finished" in body["message"].lower()
    assert body["context"] == {"documentId": DOC_ID, "status": "complete"}


def test_a_failed_document_names_the_stage_and_the_admin_reason(monkeypatch):
    post = FakePost()
    monkeypatch.setattr(notifications.httpx, "post", post)

    notifications.notify_ingestion(
        make_doc(error="No text could be read from this PDF. Upload a copy with selectable text."),
        status="failed",
        failed_stage="chunking",
    )

    body = post.calls[0]["json"]
    assert "NFPA 13 sprinkler standard" in body["message"]
    assert "chunking" in body["message"]
    assert body["details"] == (
        "No text could be read from this PDF. Upload a copy with selectable text."
    )
    assert body["context"] == {
        "documentId": DOC_ID,
        "status": "failed",
        "stage": "chunking",
    }


def test_the_failed_stage_is_the_one_in_progress_not_the_word_failed(monkeypatch):
    # The worker passes the stage that was running when it broke, never the
    # sentinel 'failed' it later appends to the stage log.
    post = FakePost()
    monkeypatch.setattr(notifications.httpx, "post", post)

    notifications.notify_ingestion(make_doc(error="x"), status="failed", failed_stage="parsing")

    assert "parsing" in post.calls[0]["json"]["message"]
    # The stage carried is the real one, never the sentinel the stage log uses.
    assert post.calls[0]["json"]["context"]["stage"] == "parsing"


def test_a_document_with_no_title_falls_back_to_the_file_name(monkeypatch):
    post = FakePost()
    monkeypatch.setattr(notifications.httpx, "post", post)

    doc = make_doc()
    del doc["title"]
    notifications.notify_ingestion(doc, status="complete")

    assert "NFPA 13 - 2022.pdf" in post.calls[0]["json"]["message"]


def test_a_retried_document_carries_its_attempt_number_in_the_context(monkeypatch):
    # The gateway folds context.attempt into the notification dedupe key, so a
    # retry that fails again is a distinct notification. The number comes from
    # the document's retryCount (bumped only when an admin presses Retry).
    post = FakePost()
    monkeypatch.setattr(notifications.httpx, "post", post)

    notifications.notify_ingestion(
        make_doc(retryCount=2, error="x"), status="failed", failed_stage="chunking"
    )

    assert post.calls[0]["json"]["context"]["attempt"] == "2"


def test_a_first_attempt_carries_no_attempt_number(monkeypatch):
    # retryCount 0 (or absent) is the original upload: no attempt key, so its
    # dedupe identity differs from retry #1's.
    post = FakePost()
    monkeypatch.setattr(notifications.httpx, "post", post)

    notifications.notify_ingestion(make_doc(retryCount=0), status="complete")

    assert "attempt" not in post.calls[0]["json"]["context"]


def test_a_gateway_error_is_swallowed_so_ingestion_is_not_broken(monkeypatch):
    post = FakePost(raise_error=ConnectionError("gateway down"))
    monkeypatch.setattr(notifications.httpx, "post", post)

    # Must not raise: the document's status is already recorded; a failed
    # notification cannot be allowed to undo that.
    notifications.notify_ingestion(make_doc(), status="complete")

    assert len(post.calls) == 1


def test_a_non_2xx_response_is_swallowed_too(monkeypatch):
    post = FakePost(status=500)
    monkeypatch.setattr(notifications.httpx, "post", post)

    notifications.notify_ingestion(make_doc(), status="complete")

    assert len(post.calls) == 1


def test_nothing_is_posted_when_the_service_key_is_unset(monkeypatch):
    # Without a key the gateway would reject the post anyway; skip it rather
    # than make a doomed request on every ingestion.
    monkeypatch.delenv("SERVICE_API_KEY", raising=False)
    post = FakePost()
    monkeypatch.setattr(notifications.httpx, "post", post)

    notifications.notify_ingestion(make_doc(), status="complete")

    assert post.calls == []


# --- Needs review (IN-07): a finished document that waits for an admin says so.


def test_a_document_that_needs_review_says_so_with_its_reason(monkeypatch):
    post = FakePost()
    monkeypatch.setattr(notifications.httpx, "post", post)

    notifications.notify_ingestion(
        make_doc(), status="complete", review_reason="Possible copy of NFPA 13 (2019 edition)"
    )

    body = post.calls[0]["json"]
    assert body["message"] == '"NFPA 13 sprinkler standard" needs review.'
    assert body["details"] == "Possible copy of NFPA 13 (2019 edition)"
    assert body["context"] == {"documentId": DOC_ID, "status": "needs_review"}


@pytest.mark.parametrize(
    ("doc", "matched", "reason"),
    [
        ({"unconfirmed": [], "match": None}, None, None),
        ({"unconfirmed": ["title"], "match": None}, None, "Unconfirmed details"),
        (
            {"unconfirmed": [], "match": {"kind": "possible_copy"}},
            {"title": "NFPA 13", "edition": "2019"},
            "Possible copy of NFPA 13 (2019 edition)",
        ),
        (
            {"unconfirmed": ["jurisdiction"], "match": {"kind": "newer_edition"}},
            {"title": "NFPA 13", "edition": None},
            "Possible newer edition of NFPA 13 · Unconfirmed details",
        ),
        # The matched document was deleted between matching and notifying.
        ({"unconfirmed": [], "match": {"kind": "possible_copy"}}, None, "Possible copy"),
        (
            {"unconfirmed": [], "match": {"kind": "possible_copy"}},
            {"title": "NFPA 13", "edition": "2019", "withdrawn": {"at": datetime(2026, 1, 1)}},
            "Possible copy of NFPA 13 (2019 edition, withdrawn)",
        ),
        (
            {"unconfirmed": ["title"], "match": None, "withdrawn": {"at": datetime(2026, 1, 1)}},
            None,
            None,
        ),
    ],
)
def test_review_reason_matches_the_lists_wording(doc, matched, reason):
    # Same words as reviewReasons() in client/src/features/knowledge-base/display.ts.
    assert notifications.review_reason(doc, matched) == reason
