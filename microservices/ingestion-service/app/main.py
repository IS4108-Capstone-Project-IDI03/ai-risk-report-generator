from fastapi import FastAPI

from app.api.routes import router

app = FastAPI(title="A2603 Ingestion Service")
app.include_router(router)


@app.get("/")
def home():
    return {"test": "test"}
