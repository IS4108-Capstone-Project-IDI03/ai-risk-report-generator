"""Docling renders scanned pages at the OCR scale, so the OCR reads a sharp image.

Docling's default renders page images at 72 DPI and OCR then works from a re-rendered, blurry
crop ("sprinkder", "haxing" in NFPA 25 2026). The converters must pass the OCR engine's scale
as the backend's render_scale. Fast: it builds the converters but converts nothing.
"""

from docling.datamodel.base_models import InputFormat

from app.labelling import pages
from app.pipeline import parser
from app.pipeline.ocr_config import get_ocr_options


def render_scale_of(converter) -> float:
    return converter.format_to_options[InputFormat.PDF].backend_options.render_scale


def test_the_ingestion_converter_renders_pages_at_the_ocr_scale():
    assert render_scale_of(parser._converter()) == get_ocr_options()[0].scale


def test_the_labelling_converter_renders_pages_at_the_ocr_scale():
    assert render_scale_of(pages._converter()) == get_ocr_options()[0].scale


def test_the_ocr_scale_is_the_sharp_one():
    # The fix assumes the engines ask for scale 3; a lower one would bring the blur back.
    assert get_ocr_options()[0].scale >= 3.0
