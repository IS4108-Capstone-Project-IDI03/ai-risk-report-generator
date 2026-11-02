"""PV-04: with protection on, the observation reader masks text and blurs faces before Gemini,
and gives the proposal back with real values. privacy-service is faked (conftest)."""

import json

import httpx
from test_vision import FakeGemini, FakeS3, client, photo, photos, sent_images, use_fakes

from app.processors import vision

PRIVACY = {
    "enabled": True,
    "known_entities": [
        {"type": "CLIENT", "names": ["Acme Holdings"]},
        {"type": "PERSON", "names": ["John Tan"]},
    ],
}
NOTE = {"label": "Note", "kind": "note", "text": "John Tan says the valves were left shut."}
RECORDING = {
    "label": "Recording 1",
    "kind": "recording",
    "text": "Acme Holdings will fix it; call +65 9123 4567.",
}
PAGE = {"label": "Page 1", "kind": "page", "text": "Escalate to John Tan."}
LOCATION = "Acme Holdings Tower · Level 3"
SEEDED = ["Acme Holdings", "John Tan", "+65 9123 4567"]


def sent_text() -> str:
    return "\n".join(p["text"] for p in FakeGemini.request["input"] if p["type"] == "text")


def test_masks_every_text_and_the_location_in_one_call(monkeypatch, fake_privacy):
    use_fakes(monkeypatch, FakeS3({}), output_text=json.dumps({"categories": []}))

    response = client.post(
        "/interpret",
        json={"texts": [NOTE, RECORDING, PAGE], "location": LOCATION, "privacy": PRIVACY},
    )

    assert response.status_code == 200, response.text
    text = sent_text()
    assert not [value for value in SEEDED if value in text]
    assert "Note (typed note):\n[PERSON_1] says the valves were left shut." in text
    assert "Location: [CLIENT_1] Tower · Level 3" in text
    assert fake_privacy.paths() == ["/mask"]


def test_gives_the_proposal_back_with_real_names(monkeypatch, fake_privacy):
    answer = {
        "categories": [
            {
                "category": "Protection",
                "reason": "Note says [PERSON_1] found the valves shut.",
                "evidence": [
                    {"item": "Note", "quote": "[PERSON_1] says the valves"},
                    {"item": "Photo 1", "quote": None},
                ],
            }
        ],
        "description": "At [CLIENT_1] Tower, it was observed that the valves were shut.",
        "hazard_type": "Fire Protection System Operation",
    }
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}), output_text=json.dumps(answer))

    response = client.post(
        "/interpret",
        json={"photos": photos("k"), "texts": [NOTE], "location": LOCATION, "privacy": PRIVACY},
    )

    body = response.json()
    assert (
        body["description"] == "At Acme Holdings Tower, it was observed that the valves were shut."
    )
    category = body["categories"][0]
    assert category["reason"] == "Note says John Tan found the valves shut."
    assert category["evidence"][0]["quote"] == "John Tan says the valves"
    assert category["evidence"][1]["quote"] is None


def test_sends_photos_only_as_privacy_service_blurred_them(monkeypatch, fake_privacy):
    s3 = FakeS3({"a": photo((400, 300)), "b": photo((200, 400))})
    use_fakes(monkeypatch, s3)

    response = client.post(
        "/interpret", json={"photos": photos("a", "b"), "texts": [NOTE], "privacy": PRIVACY}
    )

    assert response.status_code == 200, response.text
    # The fake privacy-service blacks out every photo it is sent.
    sent = sent_images()
    assert [image.size for image in sent] == [(400, 300), (200, 400)]
    assert all(image.convert("L").getextrema() == (0, 0) for image in sent)
    # Both photos in one call, then the texts in one.
    assert sorted(fake_privacy.paths()) == ["/mask", "/redact-image"]
    assert [len(body["images"]) for path, body in fake_privacy.requests if path != "/mask"] == [2]


def test_fails_closed_when_privacy_service_cannot_protect(monkeypatch, fake_privacy):
    for failure in (httpx.ConnectError("refused"), httpx.ReadTimeout("slow"), 500):
        for request in (
            {"photos": photos("k"), "privacy": PRIVACY},
            {"texts": [NOTE], "privacy": PRIVACY},
        ):
            use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}))
            fake_privacy.failure = failure

            response = client.post("/interpret", json=request)

            assert response.status_code == 502
            detail = response.json()["detail"]
            assert detail.startswith("Client details couldn't be protected")
            assert "John Tan" not in detail
            assert FakeGemini.request is None


def test_off_calls_no_privacy_service_and_sends_text_as_written(monkeypatch, fake_privacy):
    # Passed when first run: a guard on the epic's Rule 1 (off, or no `privacy`, is as before).
    for privacy in ({"enabled": False, "known_entities": []}, None):
        use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}))

        response = client.post(
            "/interpret", json={"photos": photos("k"), "texts": [NOTE], "privacy": privacy}
        )

        assert response.status_code == 200
        assert "John Tan says the valves were left shut." in sent_text()
    assert fake_privacy.requests == []


def test_records_what_was_protected_but_never_the_values(monkeypatch, fake_privacy):
    use_fakes(monkeypatch, FakeS3({"a": photo((50, 50)), "b": photo((50, 50))}))

    on = client.post(
        "/interpret",
        json={"photos": photos("a", "b"), "texts": [NOTE, RECORDING], "privacy": PRIVACY},
    ).json()
    off = client.post("/interpret", json={"photos": photos("a"), "texts": [NOTE]}).json()

    # John Tan, Acme Holdings and the phone number; the fake finds one face in each photo.
    assert on["privacy"] == {
        "enabled": True,
        "masked_count": 3,
        "faces_blurred": 2,
        "removed_from_answer": 0,
    }
    assert off["privacy"] == {
        "enabled": False,
        "masked_count": 0,
        "faces_blurred": 0,
        "removed_from_answer": 0,
    }


def test_returns_each_photo_as_sent_for_the_gateway_to_keep(monkeypatch, fake_privacy):
    use_fakes(monkeypatch, FakeS3({"a": photo((400, 300)), "b": photo((50, 50))}))

    on = client.post("/interpret", json={"photos": photos("a", "b"), "privacy": PRIVACY}).json()
    sent = [p["data"] for p in FakeGemini.request["input"] if p["type"] == "image"]
    off = client.post("/interpret", json={"photos": photos("a")}).json()

    # Exactly what Gemini received, so the engineer can see it (S5 itself stores nothing).
    assert on["redacted_photos"] == [
        {"label": "Photo 1", "faces": 1, "image": sent[0]},
        {"label": "Photo 2", "faces": 1, "image": sent[1]},
    ]
    assert "redacted_photos" not in off


def test_a_placeholder_typed_in_the_note_stays_as_typed(monkeypatch, fake_privacy):
    note = {**NOTE, "text": "John Tan wrote [PERSON_1] on the valve tag."}
    answer = {
        "categories": [
            {
                "category": "Protection",
                "reason": "[PERSON_1] reports the tag.",
                "evidence": [{"item": "Note", "quote": "wrote [LITERAL_1] on the valve tag"}],
            }
        ]
    }
    use_fakes(monkeypatch, FakeS3({}), output_text=json.dumps(answer))

    body = client.post("/interpret", json={"texts": [note], "privacy": PRIVACY}).json()

    # The typed one is set apart from the real placeholder before masking (Rule 6).
    assert "Note (typed note):\n[PERSON_1] wrote [LITERAL_1] on the valve tag." in sent_text()
    category = body["categories"][0]
    assert category["reason"] == "John Tan reports the tag."
    assert category["evidence"][0]["quote"] == "wrote [PERSON_1] on the valve tag"


class RecordingS3(FakeS3):
    """FakeS3 that also records any write, which a reading must never make."""

    def __init__(self, objects):
        super().__init__(objects)
        self.writes = []

    def put_object(self, **request):
        self.writes.append(request)

    def copy_object(self, **request):
        self.writes.append(request)


def test_leaves_the_photo_in_s3_as_it_was(monkeypatch, fake_privacy):
    # Passed when first run: a guard on the epic's AC "the S3 original is unchanged".
    original = photo((400, 300))
    s3 = RecordingS3({"k": original})
    use_fakes(monkeypatch, s3)

    client.post("/interpret", json={"photos": photos("k"), "privacy": PRIVACY})

    assert s3.objects == {"k": original}
    assert s3.writes == []


def test_every_prompt_says_to_copy_placeholders_exactly():
    # With protection off too, so off and on evals differ only in masking (as in rag-service).
    for parts in (("categories",), ("description",), ("categories", "description")):
        assert "Copy bracketed placeholders" in vision.system_instruction(parts)
    assert vision.PROMPT_VERSION == "cp21-v4"


# The answer check: details Gemini writes that the reading never sent it, such as a name or phone
# number it read off a photo, are taken out before the proposal is saved.
CHECKED = {**PRIVACY, "check_answers": True}


def test_removes_details_the_answer_adds(monkeypatch, fake_privacy):
    answer = {
        "description": "At [CLIENT_1] Tower, a notice drafted by [PERSON_1] gives +65 8888 7777.",
        "hazard_type": "Other",
    }
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}), output_text=json.dumps(answer))

    response = client.post(
        "/interpret",
        json={
            "photos": photos("k"),
            "texts": [NOTE],
            "location": LOCATION,
            "parts": ["description"],
            "privacy": CHECKED,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["description"] == (
        "At Acme Holdings Tower, a notice drafted by John Tan gives [phone number removed]."
    )
    assert fake_privacy.paths() == ["/redact-image", "/mask", "/mask"]


def test_checks_each_reason_with_the_description_in_one_call(monkeypatch, fake_privacy):
    answer = {
        "categories": [
            {
                "category": "Protection",
                "reason": "Photo 1 shows a notice to call S7654321Z.",
                "evidence": [{"item": "Photo 1", "quote": None}],
            }
        ],
        "description": "At [CLIENT_1] Tower, a notice gives +65 8888 7777.",
        "hazard_type": "Other",
    }
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}), output_text=json.dumps(answer))

    response = client.post(
        "/interpret",
        json={"photos": photos("k"), "texts": [NOTE], "location": LOCATION, "privacy": CHECKED},
    )

    body = response.json()
    assert body["categories"][0]["reason"] == "Photo 1 shows a notice to call [ID number removed]."
    assert body["description"] == "At Acme Holdings Tower, a notice gives [phone number removed]."
    assert fake_privacy.paths() == ["/redact-image", "/mask", "/mask"]


def test_keeps_a_known_name_the_answer_adds(monkeypatch, fake_privacy):
    # The client's name on a sign: known, so it stays, as it would have in the input.
    answer = {"description": "A sign reads Acme Holdings.", "hazard_type": "Other"}
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}), output_text=json.dumps(answer))

    response = client.post(
        "/interpret",
        json={"photos": photos("k"), "parts": ["description"], "privacy": CHECKED},
    )

    assert response.json()["description"] == "A sign reads Acme Holdings."


def test_leaves_the_answer_as_written_when_the_check_is_off(monkeypatch, fake_privacy):
    answer = {"description": "A notice gives +65 8888 7777.", "hazard_type": "Other"}
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}), output_text=json.dumps(answer))

    response = client.post(
        "/interpret",
        json={"photos": photos("k"), "texts": [NOTE], "parts": ["description"], "privacy": PRIVACY},
    )

    assert response.json()["description"] == "A notice gives +65 8888 7777."
    assert fake_privacy.paths() == ["/redact-image", "/mask"]


def test_fails_closed_when_the_answer_cannot_be_checked(monkeypatch, fake_privacy):
    answer = {"description": "A notice gives +65 8888 7777.", "hazard_type": "Other"}
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}), output_text=json.dumps(answer))
    serve = fake_privacy.handler

    def down_after_two(request):
        if len(fake_privacy.requests) == 2:
            raise httpx.ConnectError("refused")
        return serve(request)

    fake_privacy.handler = down_after_two

    response = client.post(
        "/interpret",
        json={"photos": photos("k"), "texts": [NOTE], "parts": ["description"], "privacy": CHECKED},
    )

    assert response.status_code == 502
    assert response.json()["detail"] == (
        "The AI's answer couldn't be checked for personal details because the privacy service "
        "isn't available, so it wasn't saved. If this keeps happening, tell your administrator."
    )


def test_records_how_many_details_the_answer_lost_never_which(monkeypatch, fake_privacy):
    answer = {
        "description": "Notices give +65 8888 7777, +65 8888 7777 and S7654321Z.",
        "hazard_type": "Other",
    }
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}), output_text=json.dumps(answer))

    response = client.post(
        "/interpret",
        json={"photos": photos("k"), "texts": [NOTE], "parts": ["description"], "privacy": CHECKED},
    )

    assert response.json()["privacy"] == {
        "enabled": True,
        "masked_count": 1,
        "faces_blurred": 1,
        "removed_from_answer": 2,
    }
