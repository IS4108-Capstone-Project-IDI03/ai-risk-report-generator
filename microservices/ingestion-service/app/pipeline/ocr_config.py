"""Dynamic OCR engine selection based on platform and GPU availability.

Selection logic
---------------
The ingestion pipeline picks an OCR engine at startup based on OS and if GPU overlay is enabled:

Resulting engine mapping
------------------------
+-----------+-----------+-------------------------------------------+
| OS        | GPU       | OCR Engine                                |
+===========+===========+===========================================+
| macOS     | any       | OcrMacOptions  (Apple Vision, built-in)   |
+-----------+-----------+-------------------------------------------+
| Windows / | yes       | NemotronOcrOptions      (fastest w/ GPU)  |
| Linux     +-----------+-------------------------------------------+
|           | no        | RapidOcrOptions         (fastest on CPU)  |
+-----------+-----------+-------------------------------------------+

Formula enrichment is disabled even on GPU pipelines
(GLM-OCR is much better at formula recognition than Nemotron).
Only text will be extracted from the Nemotron OCR engine
as it is not as hard to extract text than formulas.
"""

import logging
import os
import platform

from docling.datamodel.pipeline_options import (
    NemotronOcrOptions,
    OcrMacOptions,
    OcrMode,
    RapidOcrOptions,
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
        # macOS — use Apple's Vision framework via OcrMacOptions.
        # No external dependency needed; Vision is built into macOS.
        # GPU flag is ignored: Vision handles hardware acceleration internally.
        ocr_options = OcrMacOptions(mode=OcrMode.FULL_PAGE)
        formula_enrichment = False
        engine_name = "OcrMac/Vision (macOS)"
    elif gpu:
        # Windows / Linux with GPU overlay enabled — try Nemotron first.
        # It requires docling[feat-ocr-nemotron] (Linux x86_64 + CUDA only)
        # AND a GPU with a compatible compute capability (SM 8.0+ / Ampere or newer).
        # Falls back to RapidOCR if either condition is not met.
        try:
            import torch
            from docling.models.stages.ocr.nemotron_ocr_model import NemotronOcrModel  # noqa: F401

            if not torch.cuda.is_available():
                raise RuntimeError("CUDA not available")

            # Validate compute capability — Nemotron kernels require SM 8.0+ (Ampere).
            # cudaErrorNoKernelImageForDevice is raised at inference time on older cards,
            # which crashes the pipeline. Check early and fall back instead.
            major, minor = torch.cuda.get_device_capability()
            if major < 8:
                raise RuntimeError(
                    f"GPU compute capability {major}.{minor} is below the SM 8.0 "
                    "minimum required by Nemotron OCR kernels."
                )

            ocr_options = NemotronOcrOptions(mode=OcrMode.FULL_PAGE)
            engine_name = f"Nemotron (GPU, SM {major}.{minor})"
        except (ImportError, RuntimeError) as exc:
            logger.warning("Nemotron OCR unavailable (%s). Falling back to RapidOCR (CPU).", exc)
            ocr_options = RapidOcrOptions(mode=OcrMode.FULL_PAGE)
            engine_name = "RapidOCR (CPU, Nemotron fallback)"
        formula_enrichment = False
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
