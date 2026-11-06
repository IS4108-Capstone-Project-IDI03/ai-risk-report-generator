"""Face check for a photo attached to a chat question (CB-08). Stateless: reads S3, returns results.

Called by app/api/routes.py (/chat-photo/faces). The gateway stores the blurred copy it gets back.
"""

import boto3

from app import privacy as protection
from app.config import AWS_REGION
from app.processors.vision import _prepare, _read


def check_faces(s3_key: str) -> dict:
    """{faces, blurred_base64}: how many faces the photo has and a copy with them blurred.

    The copy is None when there are none. Faces are always looked for: the engineer decides what
    to do with them, so this does not depend on the client-details setting. Raises
    PrivacyUnavailable when privacy-service cannot be reached (fail closed: nothing is sent on).
    """
    image = _prepare(_read(boto3.client("s3", region_name=AWS_REGION), s3_key))
    session = protection.session({"enabled": True, "known_entities": []})
    blurred = session.redact_images([image])[0]
    faces = session.faces[0]
    return {"faces": faces, "blurred_base64": blurred if faces else None}
