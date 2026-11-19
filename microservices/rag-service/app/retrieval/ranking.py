"""Re-order search passages by their document's source tier (RT-04).

Called by app/chat/answer.py right after search. Only passages whose relevance is close to
the best one are re-ordered; a clearly weaker passage never moves above a clearly better one.
"""

from app.config import RANK_BAND


def apply_rank(
    passages: list[dict],
    tier_order: list[str],
    doc_tiers: dict[str, dict],
    jurisdiction: str | None,
) -> list[dict]:
    """Return the passages with the near-top band sorted by tier (best tier first).

    `doc_tiers` maps a document id (a passage's `metadata.doc_id`) to its `tier` and
    `jurisdiction`. A national code ranks only when its jurisdiction is the question's; without
    this a foreign code would outrank the local one the engineer works under.
    """
    if not tier_order or not passages:
        return passages
    doc_tiers = doc_tiers or {}

    def score(p: dict) -> float:
        # A missing, None or NaN score counts as 0: without this, one odd passage would crash
        # the chat, or (NaN) fall out of both lists and vanish from the answer.
        s = p.get("relevance_score")
        return float(s) if isinstance(s, int | float) and s == s else 0.0

    top = max(score(p) for p in passages)
    cut = top - RANK_BAND * abs(top)  # abs: a negative top would otherwise put the cut above it

    def rank(p: dict) -> int:
        doc_id = (p.get("metadata") or {}).get("doc_id")
        doc = (doc_tiers.get(doc_id) if isinstance(doc_id, str) else None) or {}
        tier = doc.get("tier")
        if tier == "national_code" and (
            not jurisdiction or doc.get("jurisdiction") != jurisdiction
        ):
            tier = None
        return tier_order.index(tier) if tier in tier_order else len(tier_order)

    band = [p for p in passages if score(p) >= cut]
    rest = [p for p in passages if score(p) < cut]
    band.sort(key=lambda p: (rank(p), -score(p)))
    return band + rest
