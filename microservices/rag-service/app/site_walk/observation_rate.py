"""Rate one observation (CP-24): its text in, a suggested category and severity out, each
marked not sure when the classifier is under the cutoff. Nothing is saved here.

Called by routes.py's /observations/rate and by eval/site_walk/rate_eval.py. Calls privacy.py
(mask) and the site walk's own rating step (propose._rate), so the matrix and cutoff match.
"""

from app import usage
from app.privacy import session as privacy_session
from app.site_walk.propose import _rate


def rate_observation(text: str, privacy: dict | None) -> dict:
    """Return {category, severity, check, usage, probabilities} for one observation's text."""
    paid_calls = usage.start()
    # 1. Mask before the classifier; masking fails closed (raises) and nothing is sent.
    [masked] = privacy_session(privacy).mask([text])
    # 2. The site walk's rating step, for one observation with no walk around it.
    o = {
        "note": masked,
        "recording_seq": None,
        "start": None,
        "end": None,
        "check": {"severity": False, "category": False},
    }
    _rate([o], [])
    # Category and severity are single words (no names), so nothing needs unmasking.
    return {
        "category": o["cope_dimension"],
        "severity": o["severity"],
        "check": o["check"],
        "usage": paid_calls,
        # Only the eval reads this; the route drops it.
        "probabilities": o["_probabilities"],
    }
