"""Table and formula OCR: `recognise()` and the GLM-OCR provider behind it.

`recognise()` is the one entry point for the table and formula extractors.
`OCR_PROVIDER` picks who reads the crop: `gemini` (`gemini_ocr`, an API call)
or `glm` (the self-hosted GLM-OCR below). Both return the same chunk text.
`glmocr` is an optional install (the local-ocr extra), so the cloud image can
import this module without it.

GLM-OCR uses `glmocr.ocr_client.OCRClient` instead of `glmocr.GlmOcr` which
POST an image plus a task prompt to the OCR service and return text. It
imports nothing heavier than `requests`.

Caching
-------
The client is built once per process and reused for every region of every
document.

`lru_cache` guards its own dict but does not serialise the factory, so two
threads that both miss can both build. FastAPI runs sync endpoints in a
threadpool, so that is reachable here; `_BUILD_LOCK` makes the build
single-flight.

The blocking preflight (`OCRClient.start()`) is skipped on purpose: it polls the
service every 10s until `connect_timeout` expires and only then raises. Skipping
it lets `process()` create the session lazily and surface a connection failure
immediately, per region, instead of stalling process startup.
"""

import base64
import os
import threading
from functools import lru_cache
from html.parser import HTMLParser
from pathlib import Path

try:
    from glmocr.config import OCRApiConfig, load_config
    from glmocr.ocr_client import OCRClient
except ImportError:  # the cloud image leaves out the local-ocr extra
    OCRApiConfig = load_config = OCRClient = None

TABLE_HEADER_DETECTION_THRESHOLD = 1.3

# Who reads table/formula crops, set by OCR_PROVIDER (never hardcoded, as with
# LLM_PROVIDER and VISION_PROVIDER). glm is the default until the GLM-vs-Gemini
# comparison settles it.
OCR_PROVIDERS = ("anthropic", "gemini", "glm")

# GLM-OCR's own task prompts, copied from the SDK's packaged config.yaml
# (`pipeline.page_loader.task_prompt_mapping`). The model was trained against
# these exact strings, so they are not ours to reword.
TASK_PROMPTS = {
    "text": "Text Recognition:",
    "table": "Table Recognition:",
    "formula": "Formula Recognition:",
}

# Service config lives at the service root; `load_config` layers
# GLMOCR_* env vars and .env on top of it (env wins), which is how Compose
# points us at the `ollama` service instead of localhost.
CONFIG_PATH = Path(__file__).resolve().parents[3] / "config.yml"

# Generation parameters. These are tuned for table/formula OCR on CPU via
MAX_TOKENS = 300
MAX_TOKENS_RETRY = 1200
_ADAPTIVE_RETRIES = 2

TEMPERATURE = 0.0
REPEAT_PENALTY = 1.05

_BUILD_LOCK = threading.Lock()


def _ocr_api_config() -> OCRApiConfig:
    """Resolve the OCR API config from YAML + environment.

    `load_config` already maps GLMOCR_MODE / GLMOCR_OCR_API_HOST /
    GLMOCR_OCR_API_PORT / GLMOCR_OCR_MODEL / GLMOCR_OCR_API_URL /
    GLMOCR_OCR_API_KEY. It does *not* map `api_mode` or `api_path`, which are the
    two knobs that differ between an Ollama backend (`/api/generate`,
    `ollama_generate`) and an OpenAI-compatible one such as vLLM
    (`/v1/chat/completions`, `openai`), so those are applied here to keep the
    backend switchable without editing YAML.
    """
    # Passing a non-existent path raises; fall back to the SDK default YAML so a
    # missing config.yml degrades to "env vars only" rather than crashing.
    config = load_config(CONFIG_PATH if CONFIG_PATH.is_file() else None)
    ocr_api = config.pipeline.ocr_api

    api_mode = os.getenv("GLMOCR_OCR_API_MODE", "").strip()
    if api_mode:
        ocr_api.api_mode = api_mode

    api_path = os.getenv("GLMOCR_OCR_API_PATH", "").strip()
    if api_path:
        ocr_api.api_path = api_path

    # CPU inference on a full-page table crop can take several minutes.
    # The SDK default (120 s) is too short; override unless explicitly set.
    timeout_env = os.getenv("GLMOCR_OCR_REQUEST_TIMEOUT", "").strip()
    ocr_api.request_timeout = int(timeout_env) if timeout_env else 600

    return ocr_api


@lru_cache(maxsize=1)
def _build_client() -> OCRClient:
    """Construct the client. Cached; call `ocr_client()` instead."""
    if OCRClient is None:
        raise RuntimeError(
            "GLM-OCR is not installed in this image. Set OCR_PROVIDER=gemini, or run with "
            "docker-compose.local-ocr.yml (which installs the local-ocr extra)."
        )
    return OCRClient(_ocr_api_config())


def ocr_client() -> OCRClient:
    """The process-wide OCR client, built on first use."""
    with _BUILD_LOCK:
        return _build_client()


def close_ocr_client() -> None:
    """Close the pooled HTTP session and drop the cached client.

    Safe when nothing was built: `currsize` is checked so we do not construct a
    client purely in order to close it.
    """
    with _BUILD_LOCK:
        if _build_client.cache_info().currsize:
            try:
                _build_client().stop()
            except Exception:  # noqa: BLE001 - shutdown must not raise
                pass
        _build_client.cache_clear()


def _data_uri(image_png: bytes) -> str:
    """Encode PNG bytes as a data URI.

    Both API modes consume this: the OpenAI path forwards it as an `image_url`,
    and `ollama_generate` splits the base64 payload back out for Ollama's
    `images` field.
    """
    encoded = base64.b64encode(image_png).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _looks_truncated(text: str, task: str) -> bool:
    """Return True if the output appears to be cut off mid-generation.

    Used to decide whether to retry with a higher token budget.

    For tables: look for an opening <table> tag without a matching closing </table> tag.
    if the closing tag is present but comes before the opening tag, treat it as truncated.

    For formulas: LaTeX expressions commonly end with ``}`` or ``$``. An
    unmatched opening delimiter is a reasonable truncation signal, but false
    positives here are low-cost (just one extra inference call), so we use a
    simple heuristic: the text ends mid-word (no sentence-ending punctuation and
    no closing delimiter).

    Returns False for unknown tasks so unknown content is never retried.
    """
    if not text:
        return False

    if task == "table":
        start = text.lower().find("<table")
        if start < 0:
            return True
        end = text.lower().find("</table")
        if end < 0:
            return True
        if end < start:
            return True
        # Stick with detecting closing tag of table first
        # Checking for closing tag of rows might be too strict for badly parsed table
        # Currently just detecting any table
        return False

    if task == "formula":
        # LaTeX: unbalanced braces or an open $ is a clear sign of truncation.
        return text.count("{") > text.count("}") or text.count("$") % 2 != 0

    return False


def recognise(image_png: bytes, task: str) -> str | None:
    """Recognise one cropped region, returning table records or LaTeX text.

    Args:
        image_png: the region as PNG bytes (see `image_crop.crop_png`).
        task: one of `TASK_PROMPTS` — "table", "formula" or "text". Selects the
            prompt the model was trained on for that content type.

    Returns:
        The recognised text, or None when the service errored or returned
        nothing. Returning None rather than raising keeps one unreadable region
        from failing a whole document; the caller decides whether to fall back.

    Raises:
        ValueError: for an unknown task, which is a programming error rather
            than a runtime condition.
    """
    try:
        prompt = TASK_PROMPTS[task]
    except KeyError:
        expected = sorted(TASK_PROMPTS)
        raise ValueError(f"unknown OCR task {task!r}; expected one of {expected}") from None

    provider = os.getenv("OCR_PROVIDER", "").strip() or "glm"
    if provider not in OCR_PROVIDERS:
        raise ValueError(f"OCR_PROVIDER {provider!r} is not supported; use one of {OCR_PROVIDERS}")
    # API providers are imported here so the GLM path never loads their SDKs.
    if provider == "anthropic":
        from app.pipeline.chunking_helper import anthropic_ocr

        return anthropic_ocr.recognise(image_png, task)
    if provider == "gemini":
        from app.pipeline.chunking_helper import gemini_ocr

        return gemini_ocr.recognise(image_png, task)

    token_budgets = _token_budgets()

    for max_tokens in token_budgets:
        payload = {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": _data_uri(image_png)}},
                    ],
                }
            ],
            "max_tokens": max_tokens,
            "temperature": TEMPERATURE,
            # Down-weight tokens that have already appeared. Prevents the model from
            # getting stuck in repetition loops (repeated table rows, formula
            # fragments) which cause the server to abort with "token repeat limit
            # reached" and trigger expensive retries.
            # Named "repetition_penalty" because OCRClient._convert_to_ollama_generate
            # maps that key to Ollama's "repeat_penalty" option. Using Ollama's native
            # name directly would be silently dropped by the converter.
            "repetition_penalty": REPEAT_PENALTY,
            "stop": ["</table>"],
        }

        response, status = ocr_client().process(payload)
        if status != 200 or "error" in response:
            return None

        choices = response.get("choices") or []
        if not choices:
            return None
        content = (choices[0].get("message", {}).get("content") or "").strip()
        if not content:
            return None

        truncated = _looks_truncated(content, task)

        if not truncated or max_tokens == token_budgets[-1]:
            if task == "table":
                table_html = post_process_deduplication(content) or content
                content = table_to_records(html_table_to_list(table_html))
            return content

        # Output looks truncated — retry with a higher budget if we have one.
        # If this was already the last budget, return what we have rather than
        # dropping the region entirely.
        if max_tokens == token_budgets[-1]:
            return content

    return None  # unreachable but satisfies type checkers


def _get_raw_string(raw: str) -> str:
    return "".join(raw.split()).strip()


def post_process_deduplication(text: str) -> str:
    tables = text.split("<table")
    hashmap = {}
    for table in tables:
        if "</table>" in table:
            hashmap[hash(table)] = table
    deduplicated_tables = list(hashmap.values())

    full_tables = []
    deduplicated_tables = sorted(deduplicated_tables, key=len, reverse=True)
    for idx in range(len(deduplicated_tables)):
        is_partial = False
        for idx2 in range(idx + 1, len(deduplicated_tables)):
            if _get_raw_string(deduplicated_tables[idx]) in _get_raw_string(
                deduplicated_tables[idx2]
            ):
                is_partial = True
                break
        if not is_partial:
            full_tables.append("<table" + deduplicated_tables[idx])
    return "\n".join(full_tables)


def _token_budgets() -> list[int]:
    """Sequence of max_token values to try: [MAX_TOKENS, ..., MAX_TOKENS_RETRY]"""
    if _ADAPTIVE_RETRIES == 0 or MAX_TOKENS >= MAX_TOKENS_RETRY:
        return [MAX_TOKENS]
    step = (MAX_TOKENS_RETRY - MAX_TOKENS) // _ADAPTIVE_RETRIES
    budgets = [MAX_TOKENS + step * i for i in range(_ADAPTIVE_RETRIES)]
    budgets.append(MAX_TOKENS_RETRY)
    return budgets


class TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.table = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self.row = []
        elif tag in ("th", "td"):
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("th", "td"):
            self.row.append("".join(self.cell).strip())
            self.cell = None
        elif tag == "tr":
            self.table.append(self.row)
            self.row = None


def html_table_to_list(html: str) -> list[list[str]]:
    parser = TableParser()
    parser.feed(html)
    converted = parser.table
    return converted


def _sum_of_row(row: list[str]) -> int:
    return sum(len(str(cell)) for cell in row if cell is not None)


def _header_detection(table: list[list[str]]) -> tuple[bool, bool]:
    """Return whether a table has a header and whether it is vertical."""
    has_header = False
    vertical_score = 0
    horizontal_score = 0

    # Check whether the first row is much longer than the remaining rows.
    first_row = table[0]
    remaining_rows = table[1:]
    length_first_row = _sum_of_row(first_row)
    avg_length_rest_rows = 0
    for row in remaining_rows:
        avg_length_rest_rows += _sum_of_row(row)
    avg_length_rest_rows = avg_length_rest_rows / len(remaining_rows) if remaining_rows else 0

    if avg_length_rest_rows == 0:
        return (False, True)  # No header, vertical table
    diff = abs(length_first_row - avg_length_rest_rows)
    if (
        diff > avg_length_rest_rows * 1.5
        or diff > length_first_row * TABLE_HEADER_DETECTION_THRESHOLD
    ):
        has_header = True
        avg_row_length = (avg_length_rest_rows + length_first_row) / 2
        vertical_score = diff / avg_row_length if avg_row_length > 0 else 0

    # Check whether the first column is much longer than the other columns.
    first_col = [row[0] for row in table]
    remaining_cols = [row[1:] for row in table]
    length_first_col = _sum_of_row(first_col)
    length_rest_cols = []

    for col in zip(*remaining_cols):
        length_rest_cols.append(_sum_of_row(col))
    avg_length_rest_cols = sum(length_rest_cols) / len(length_rest_cols) if length_rest_cols else 0

    if avg_length_rest_cols == 0:
        return (False, False)  # No header, horizontal table
    diff = abs(length_first_col - avg_length_rest_cols)
    if (
        diff > avg_length_rest_cols * 1.5
        or diff > length_first_col * TABLE_HEADER_DETECTION_THRESHOLD
    ):
        has_header = True
        avg_col_length = (avg_length_rest_cols + length_first_col) / 2
        horizontal_score = diff / avg_col_length if avg_col_length > 0 else 0

    if has_header is False:
        return (False, True)  # No header, vertical table
    if vertical_score > horizontal_score:
        return (has_header, True)  # Header exists, vertical table
    return (has_header, False)  # Header exists, horizontal table


def table_to_records(table: list[list[str]], header_hint: str | None = None) -> str:
    """Flatten rows into one "Heading: value; ..." record per line.

    `header_hint` ("row" | "column" | "none") is the provider's own reading of
    where the headings are; without it the length heuristic guesses.
    """
    if table is None or len(table) < 1:
        return ""

    if header_hint in ("row", "column", "none"):
        has_header, is_vertical = header_hint != "none", header_hint == "column"
    else:
        has_header, is_vertical = _header_detection(table)
    if is_vertical:
        table = list(map(list, zip(*table)))

    if not has_header:
        table = [["" for _ in range(len(table[0]))]] + table

    header, *body = table
    records = []

    for row in enumerate(body, start=1):
        fields = []
        for index, value in enumerate(row[1]):
            column = header[index] if index < len(header) else ""
            if column and value:
                fields.append(f"{column}: {value}")
            elif value:
                fields.append(f"{value}")

        record = "; ".join(fields)
        if record:
            records.append(record)

    return "\n".join(records)
