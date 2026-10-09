"""In-memory stand-ins for Chroma and the `knowledge_documents` collection (IN-07 tests).

The Chroma fake does real cosine-distance maths over hand-made vectors, so the
matching tests exercise the same threshold logic Chroma would, with no server
and no embedding model.
"""

import numpy as np
from bson import ObjectId


class FakePassages:
    """The Chroma calls matching makes: get, query, update and delete over fixed vectors."""

    def __init__(self):
        self.rows = {}  # id -> {"text", "meta", "vector"}

    def add(self, doc_id: str, vectors: list[list[float]], texts: list[str] | None = None):
        for n, vector in enumerate(vectors):
            self.rows[f"{doc_id}:{n}"] = {
                "text": (texts or [f"text {n}"] * len(vectors))[n],
                "meta": {"doc_id": doc_id, "page_start": n + 1, "page_end": n + 1},
                "vector": np.asarray(vector, dtype=float),
            }

    def _select(self, where):
        doc = where["doc_id"]
        wanted = set(doc["$in"]) if isinstance(doc, dict) else {doc}
        return [(i, r) for i, r in self.rows.items() if r["meta"]["doc_id"] in wanted]

    def get(self, where, include=()):
        chosen = self._select(where)
        return {
            "ids": [i for i, _ in chosen],
            "documents": [r["text"] for _, r in chosen],
            "metadatas": [r["meta"] for _, r in chosen],
            "embeddings": [r["vector"] for _, r in chosen],
        }

    def query(self, query_embeddings, n_results, where, include=()):
        chosen = self._select(where)
        out = {"ids": [], "distances": [], "metadatas": []}
        for q in query_embeddings:
            q = np.asarray(q, dtype=float)
            scored = sorted(
                (1 - float(q @ r["vector"] / (np.linalg.norm(q) * np.linalg.norm(r["vector"]))), i)
                for i, r in chosen
            )[:n_results]
            out["ids"].append([i for _, i in scored])
            out["distances"].append([d for d, _ in scored])
            out["metadatas"].append([self.rows[i]["meta"] for _, i in scored])
        return out

    def delete(self, ids):
        for i in ids:
            del self.rows[i]


class FakeDocuments:
    """The pymongo calls matching and the routes make, over a list of documents."""

    def __init__(self, *docs):
        self.docs = list(docs)

    def find(self, query):
        return [
            d
            for d in self.docs
            if d["status"] == query["status"] and d["_id"] != query["_id"]["$ne"]
        ]

    def find_one(self, query):
        return next((d for d in self.docs if d["_id"] == query["_id"]), None)

    def update_one(self, query, update):
        self.find_one(query).update(update["$set"])


def stored_doc(title="NFPA 13", edition="2022", **extra) -> dict:
    """Return a complete standard record shaped like the gateway writes it."""
    return {
        "_id": ObjectId(),
        "status": "complete",
        "title": title,
        "issuingBody": "NFPA",
        "standardNumber": "13",
        "edition": edition,
        "unconfirmed": [],
        "metadata": {"source_type": "nfpa_standard"},
        **extra,
    }
