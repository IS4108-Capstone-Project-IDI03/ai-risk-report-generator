# Adds two fake passages to Chroma so EV-01's passage checks can be shown without
# ingesting a document or paying for an embedding (the vector is a placeholder).
# Run:   docker compose exec -T rag-service python - < scripts/demo/ev01-chroma.py
# Clean: docker compose exec -T rag-service python - clean < scripts/demo/ev01-chroma.py
import sys
from app.retrieval_config import COLLECTION, chroma_client

collection = chroma_client().get_or_create_collection(name=COLLECTION, embedding_function=None)
ids = ["demo-doc:1", "demo-withdrawn:1"]
if "clean" in sys.argv:
    collection.delete(ids=ids)
    print("removed the demo passages")
else:
    collection.upsert(
        ids=ids,
        embeddings=[[0.0] * 1024, [0.0] * 1024],
        documents=["EV-01 demo passage (active).", "EV-01 demo passage (withdrawn document)."],
        metadatas=[
            {"doc_id": "demo-doc", "status": "active", "page_start": 3},
            {"doc_id": "demo-withdrawn", "status": "withdrawn", "page_start": 9},
        ],
    )
    print("added", ids, "to", COLLECTION)
