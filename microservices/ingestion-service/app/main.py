from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Release the pooled OCR HTTP session on shutdown.

    The OCR client is cached for the life of the process (see
    `chunking_helper.ocr_model`), so it owns a `requests.Session` that should be
    closed explicitly rather than left to the garbage collector. Imported lazily
    so starting the app does not pull the chunking stack.
    """
    yield

    from app.pipeline.chunking_helper.ocr_model import close_ocr_client

    close_ocr_client()


app = FastAPI(title="A2603 Ingestion Service", lifespan=lifespan)
app.include_router(router)


@app.get("/")
def home():
    return {"test": "test"}
