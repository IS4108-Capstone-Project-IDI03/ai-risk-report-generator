from fastapi import Depends, FastAPI

from app.api.routes import router
from app.model_override import read_model_header

app = FastAPI(title="A2603 RAG Service", dependencies=[Depends(read_model_header)])
app.include_router(router)
