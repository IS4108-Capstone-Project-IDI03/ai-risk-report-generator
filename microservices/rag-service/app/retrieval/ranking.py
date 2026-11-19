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
    top = max(p.get("relevance_score", 0) for p in passages)
    cut = top - RANK_BAND * top

    def rank(p: dict) -> int:
        doc = doc_tiers.get(p["metadata"].get("doc_id")) or {}
        tier = doc.get("tier")
        if tier == "national_code" and (
            not jurisdiction or doc.get("jurisdiction") != jurisdiction
        ):
            tier = None
        return tier_order.index(tier) if tier in tier_order else len(tier_order)

    band = [p for p in passages if p.get("relevance_score", 0) >= cut]
    rest = [p for p in passages if p.get("relevance_score", 0) < cut]
    # sorted is stable, so ties on tier keep the score order; the sort key adds it explicitly.
    band.sort(key=lambda p: (rank(p), -p.get("relevance_score", 0)))
    return band + rest
