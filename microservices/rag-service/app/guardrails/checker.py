"""Groundedness and citation checking."""


def check(generated_text: str) -> dict:
    """Stub behind the free-text /generate route."""
    return {"passed": True}


def check_citations(subsections: list[dict], citable: set[str]) -> dict:
    """Mark each statement supported only if it cites something and every ID it cites exists.

    `citable` holds the observation (O:) and standard (C:) IDs given to the model. A past-report
    (P:) ID is not citable, so a statement resting only on one is unsupported. This checks
    that each citation resolves (GN-01 AC4). Checking that the source actually says what the
    statement claims is GN-02.
    """
    unsupported = 0
    for sub in subsections:
        for statement in sub["statements"]:
            cited = statement["citations"]
            statement["supported"] = bool(cited) and all(c in citable for c in cited)
            unsupported += not statement["supported"]
    return {"passed": unsupported == 0, "unsupported_count": unsupported}
