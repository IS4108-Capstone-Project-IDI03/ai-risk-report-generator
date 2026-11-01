"""PV-04 leak test (the epic's Rule 10): with protection on, no seeded client detail reaches
Gemini, in any text or photo. Gemini and S3 are faked (test_vision); privacy-service's /mask and
/redact-image are faked in-process (conftest `fake_privacy`), so every step between the route and
the paid API runs for real."""

import json

from test_vision import FakeGemini, FakeS3, client, photo, photos, sent_images, use_fakes

SEEDED = ["Acme Holdings", "John Tan", "+65 9123 4567", "S1234567D"]
PRIVACY = {
    "enabled": True,
    "known_entities": [
        {"type": "CLIENT", "names": ["Acme Holdings"]},
        {"type": "PERSON", "names": ["John Tan"]},
    ],
}


def test_no_seeded_detail_reaches_gemini(monkeypatch, fake_privacy):
    use_fakes(monkeypatch, FakeS3({"a": photo((400, 300)), "b": photo((300, 400))}))

    response = client.post(
        "/interpret",
        json={
            "photos": photos("a", "b"),
            "texts": [
                {"label": "Note", "kind": "note", "text": "John Tan (NRIC S1234567D) saw it."},
                {
                    "label": "Recording 1",
                    "kind": "recording",
                    "text": "Acme Holdings will fix it; call +65 9123 4567.",
                },
                {"label": "Page 1", "kind": "page", "text": "Tell John Tan at Acme Holdings."},
            ],
            "location": "Acme Holdings Tower · Level 3",
            "privacy": PRIVACY,
        },
    )

    assert response.status_code == 200, response.text
    payload = json.dumps(
        {key: value for key, value in FakeGemini.request.items() if key != "response_format"}
    )
    assert [value for value in SEEDED if value in payload] == []
    # Every photo went as privacy-service returned it (the fake blacks each one out).
    assert all(image.convert("L").getextrema() == (0, 0) for image in sent_images())
