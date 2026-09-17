"""Stage 2: anonymise parsed text before it is chunked.

Positioned in the pipeline between parsing and chunking. For now this is a
pass-through: it takes the parser's text blocks and returns them unchanged.
Real PII stripping/masking is future work — when it lands it must preserve the
same shape (``list[TextBlock]`` in, text blocks out) and each block's
provenance (``section_path``, ``page``, ``order``).

Tables and images bypass this stage entirely; only body text flows through here.
"""

from app.pipeline.parser import TextBlock


def anonymise(text_blocks: list[TextBlock]) -> list[TextBlock]:
    """Return the text blocks unchanged (pass-through).

    Args:
        text_blocks: body text blocks produced by the parser.

    Returns:
        The same blocks, content untouched. A future implementation will mask
        PII here without altering provenance or ordering (list order must be the same after anonymising).
    """
    return text_blocks
