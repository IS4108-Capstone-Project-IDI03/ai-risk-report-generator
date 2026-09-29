"""Property tests for the pure Coord_Transform of the TEMPORARY debug viewer.

These tests cover ONLY ``_bbox_to_canvas_rect`` from
``app.pipeline.chunker_with_display`` — the single pure, unit-testable piece of
the throwaway debug tool (Req 5.1, Req 7.1).

Headless-safe (Req 7.2): NO Tk window is ever opened and neither Docling models
nor PyMuPDF are required. We import the pure function directly; if importing the
module genuinely fails because a heavy top-level dependency is unavailable, we
skip gracefully, mirroring the skip guard in ``tests/test_chunker.py``.

hypothesis is NOT a project dependency, so the randomized property checks use a
deterministic seeded ``random`` loop (>=100 iterations) instead.
"""

import random

import pytest

try:
    from app.pipeline.chunker_with_display import _bbox_to_canvas_rect
except Exception as exc:  # noqa: BLE001
    pytest.skip(
        f"chunker_with_display unavailable in this environment: {exc}",
        allow_module_level=True,
    )


# Number of randomized iterations for each property (>=100 per design/testing strategy).
PROPERTY_ITERATIONS = 200
# Fixed seed so the deterministic loop is reproducible (hypothesis is not a dep).
RANDOM_SEED = 20240921


def _random_bbox_case(rng: random.Random):
    """Draw a plausible (l, t, r, b, H, S) case within a sane input space."""
    left = rng.uniform(0, 1000)
    right = rng.uniform(0, 1000)
    top = rng.uniform(0, 1000)
    bottom = rng.uniform(0, 1000)
    height = rng.uniform(1, 2000)
    stride = rng.uniform(0.1, 5.0)
    return left, top, right, bottom, height, stride


# --- Property 1: bottom-left origin flips against page height -----------------
# Feature: chunk-bbox-debug-viewer, Property 1: Bottom-left origin flips against
# page height.
# Validates: Requirements 5.2


def test_property1_bottom_left_known_value():
    """Feature: chunk-bbox-debug-viewer, Property 1: Bottom-left origin flips
    against page height (known value). Validates: Requirements 5.2."""
    result = _bbox_to_canvas_rect((10, 700, 100, 650), 792, 2.0, "CoordOrigin.BOTTOMLEFT")
    assert result == (20, 184, 200, 284)


def test_property1_bottom_left_flip_randomized():
    """Feature: chunk-bbox-debug-viewer, Property 1: Bottom-left origin flips
    against page height (randomized). Validates: Requirements 5.2.

    For any bbox (l, t, r, b), page height H, and scale S, a bottom-left origin
    (no "TOP") maps to exactly (l*S, (H-t)*S, r*S, (H-b)*S).
    """
    rng = random.Random(RANDOM_SEED)
    bottom_left_origins = ["CoordOrigin.BOTTOMLEFT", "bottomleft", "BOTTOM_LEFT", ""]
    for _ in range(PROPERTY_ITERATIONS):
        left, top, right, bottom, height, stride = _random_bbox_case(rng)
        origin = rng.choice(bottom_left_origins)
        assert "TOP" not in origin.upper()  # guard the test's own assumption
        result = _bbox_to_canvas_rect((left, top, right, bottom), height, stride, origin)
        assert result == (
            left * stride,
            (height - top) * stride,
            right * stride,
            (height - bottom) * stride,
        )


# --- Property 2: top-left origin applies no vertical flip ---------------------
# Feature: chunk-bbox-debug-viewer, Property 2: Top-left origin applies no
# vertical flip.
# Validates: Requirements 5.3


def test_property2_top_left_known_value():
    """Feature: chunk-bbox-debug-viewer, Property 2: Top-left origin applies no
    vertical flip (known value). Validates: Requirements 5.3."""
    result = _bbox_to_canvas_rect((10, 700, 100, 650), 792, 2.0, "CoordOrigin.TOPLEFT")
    assert result == (20, 1400, 200, 1300)


def test_property2_top_left_no_flip_randomized():
    """Feature: chunk-bbox-debug-viewer, Property 2: Top-left origin applies no
    vertical flip (randomized). Validates: Requirements 5.3.

    For any bbox (l, t, r, b), page height H, and scale S, a top-left origin
    (contains "TOP", case-insensitive) maps to exactly (l*S, t*S, r*S, b*S) with
    no H-flip on y. H must not affect the result.
    """
    rng = random.Random(RANDOM_SEED)
    top_left_origins = ["CoordOrigin.TOPLEFT", "topleft", "TopLeft", "TOP_LEFT"]
    for _ in range(PROPERTY_ITERATIONS):
        left, top, right, bottom, height, stride = _random_bbox_case(rng)
        origin = rng.choice(top_left_origins)
        assert "TOP" in origin.upper()  # guard the test's own assumption
        result = _bbox_to_canvas_rect((left, top, right, bottom), height, stride, origin)
        assert result == (left * stride, top * stride, right * stride, bottom * stride)
