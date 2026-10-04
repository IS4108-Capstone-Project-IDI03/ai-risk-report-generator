"""Dynamic OCR engine selection based on platform and GPU availability.

Selection logic
---------------
The ingestion pipeline picks an OCR engine at startup based on OS and if GPU overlay is enabled:

Resulting engine mapping
------------------------
+-----------+-----------+-------------------------------------------+
| OS        | GPU       | OCR Engine                                |
+===========+===========+===========================================+
| macOS     | any       | TesseractCliOcrOptions  (only stable opt) |
+-----------+-----------+-------------------------------------------+
| Windows / | yes       | NemotronOcrOptions      (fastest w/ GPU)  |
| Linux     +-----------+-------------------------------------------+
|           | no        | RapidOcrOptions         (fastest on CPU)  |
+-----------+-----------+-------------------------------------------+

Formula enrichment is disabled even on GPU pipelines (GLM-OCR is much better at formula recognition than Nemotron). 
Only text will be extracted from the Nemotron OCR engine as it is not as hard to extract text than formulas.
"""

import logging
import os
import platform

from docling.datamodel.pipeline_options import (
    NemotronOcrOptions,
    OcrMode,
    RapidOcrOptions,
    TesseractCliOcrOptions,
)

logger = logging.getLogger(__name__)


def is_gpu_enabled() -> bool:
    """Return True when the GPU Docker Compose overlay has been applied.

    The overlay (``docker-compose.gpu.yml``) injects ``GPU_ENABLED=true`` into
    the container environment. On a plain ``docker compose up`` or a bare-metal
    run without the overlay that variable is absent or set to ``"false"``.
    """
    return os.getenv("GPU_ENABLED", "false").strip().lower() == "true"


def get_ocr_options() -> tuple[object, bool]:
    """Return ``(ocr_options, do_formula_enrichment)`` for the current environment.

    The returned tuple is meant to be unpacked directly into
    ``PdfPipelineOptions``::

        ocr_options, formula_enrichment = get_ocr_options()

    Returns:
        ocr_options: an ``*OcrOptions`` instance appropriate for the current
            platform and GPU configuration.
        do_formula_enrichment: ``True`` when GPU is available and formula
            enrichment is cost-effective; ``False`` otherwise.
    """
    system = platform.system()  # "Darwin" | "Windows" | "Linux"
    gpu = is_gpu_enabled()

    if system == "Darwin":
        # macOS — only TesseractCli is stable; GPU flag is ignored.
        ocr_options = TesseractCliOcrOptions(mode=OcrMode.FULL_PAGE)
        formula_enrichment = False
        engine_name = "TesseractCli (macOS)"
    elif gpu:
        # Windows / Linux with GPU overlay enabled.
        ocr_options = NemotronOcrOptions(mode=OcrMode.FULL_PAGE)
        formula_enrichment = False
        engine_name = "Nemotron (GPU)"
    else:
        # Windows / Linux without GPU — RapidOCR is faster than Tesseract CLI
        # on CPU because it runs ONNX-quantised PaddleOCR models.
        ocr_options = RapidOcrOptions(mode=OcrMode.FULL_PAGE)
        formula_enrichment = False
        engine_name = "RapidOCR (CPU)"

    logger.info(
        "OCR engine selected: %s (platform=%s, GPU_ENABLED=%s)",
        engine_name,
        system,
        gpu,
    )
    return ocr_options, formula_enrichment
