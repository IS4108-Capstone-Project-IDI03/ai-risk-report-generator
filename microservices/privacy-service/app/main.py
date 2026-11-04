import logging

from fastapi import FastAPI

from app import detectors
from app.api.routes import router

# Read now, so a typo in detectors.json stops the service from starting (PV-04). Kinds only,
# never text (Rule 5).
_off = [kind for kind in detectors.KINDS if kind not in detectors.enabled()]
if _off:
    logging.getLogger("uvicorn.error").warning(
        "detectors.json switches off: %s. Known names are still masked.", ", ".join(_off)
    )

app = FastAPI(title="A2603 Privacy Service")
app.include_router(router)
