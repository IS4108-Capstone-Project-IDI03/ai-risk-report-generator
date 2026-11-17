"""S-01: the admin's model (X-Model header) is used for photos and handwriting, and only then."""

from fastapi.testclient import TestClient

from app import config
from app.main import app
from app.model_override import MODEL_OVERRIDE
from app.processors import handwriting, vision

client = TestClient(app)


# Throwaway routes that read the model the way vision.py and handwriting.py do (sync, so they
# run in a worker thread like the real ones).
@app.get("/_test/vision-model")
def _vision_model() -> dict:
    return {"model": vision._model()}


@app.get("/_test/handwriting-model")
def _handwriting_model() -> dict:
    return {"model": MODEL_OVERRIDE.get() or handwriting.HANDWRITING_MODEL}


def test_the_header_model_is_used_for_photos_and_handwriting():
    headers = {"X-Model": "gemini-9-test"}
    assert client.get("/_test/vision-model", headers=headers).json()["model"] == "gemini-9-test"
    assert (
        client.get("/_test/handwriting-model", headers=headers).json()["model"] == "gemini-9-test"
    )


def test_without_the_header_the_env_defaults_are_unchanged():
    assert client.get("/_test/vision-model").json()["model"] == config.VISION_MODEL
    assert client.get("/_test/handwriting-model").json()["model"] == config.HANDWRITING_MODEL
