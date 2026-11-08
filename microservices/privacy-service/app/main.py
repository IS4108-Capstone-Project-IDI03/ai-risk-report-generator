import logging

from fastapi import FastAPI

from app import allow_list, detectors
from app.api.routes import router

# Read now, so a typo in detectors.json stops the service from starting (PV-04). Kinds only,
# never text (Rule 5).
_off = [kind for kind in detectors.KINDS if kind not in detectors.enabled()]
if _off:
    logging.getLogger("uvicorn.error").warning(
        "detectors.json switches off: %s. Known names are still masked.", ", ".join(_off)
    )

# Read now too, so a typo in allow_list.json stops the service from starting (PV-05).
allow_list.lists()

app = FastAPI(title="A2603 Privacy Service")
app.include_router(router)
