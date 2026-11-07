"""In-memory stand-ins for Chroma and the `knowledge_documents` collection (IN-07 tests), and
for privacy-service's /mask (PV-05).

The Chroma fake does real cosine-distance maths over hand-made vectors, so the
matching tests exercise the same threshold logic Chroma would, with no server
and no embedding model.
"""

import json
import re

import httpx
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

    def get(self, where, include=(), limit=None, offset=0):
        chosen = self._select(where)[offset : None if limit is None else offset + limit]
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


class FakePrivacy:
    """Stands in for privacy-service's POST /mask, with the spans PV-05 added: swaps each known
    entity's names, a +65 number and an NRIC for typed placeholders, numbered in reading order
    and extending the mapping it is sent. `failure` makes it fail: an httpx exception to raise,
    or a status code. `.requests` holds each request body."""

    PATTERNS = {"PHONE": re.compile(r"\+65 \d{4} \d{4}"), "NRIC": re.compile(r"\bS\d{7}[A-Z]\b")}

    def __init__(self):
        self.requests: list[dict] = []
        self.failure: Exception | int | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        if isinstance(self.failure, Exception):
            raise self.failure
        if self.failure:
            return httpx.Response(self.failure, json={"detail": "boom"})
        body = json.loads(request.content)
        self.requests.append(body)
        mapping = dict(body.get("mapping") or {})
        texts, spans = [], []
        for text in body["texts"]:
            found = self._found(text, body.get("known_entities") or [])
            where = [
                {"start": s, "end": e, "placeholder": self._placeholder(mapping, kind, value)}
                for s, e, kind, value in found
            ]
            for span in reversed(where):
                text = text[: span["start"]] + span["placeholder"] + text[span["end"] :]
            texts.append(text)
            spans.append(where)
        return httpx.Response(200, json={"texts": texts, "mapping": mapping, "spans": spans})

    def _found(self, text: str, known: list[dict]) -> list[tuple[int, int, str, str]]:
        """(start, end, type, restores-to) for each detail, left to right, none overlapping."""
        found = [
            (m.start(), m.end(), entity["type"], entity["names"][0])
            for entity in known
            for name in entity["names"]
            for m in re.finditer(self._name_pattern(name), text)
        ]
        found += [
            (m.start(), m.end(), kind, m[0])
            for kind, pattern in self.PATTERNS.items()
            for m in pattern.finditer(text)
        ]
        kept = []
        for span in found:  # known names first, so they win where spans overlap
            if not any(span[0] < k[1] and k[0] < span[1] for k in kept):
                kept.append(span)
        return sorted(kept)

    @staticmethod
    def _name_pattern(name: str) -> str:
        """Any spacing between a name's words, a line break too, as privacy-service matches."""
        words = r"\s+".join(map(re.escape, name.split()))
        return rf"(?<!\w){words}(?!\w)"

    @staticmethod
    def _placeholder(mapping: dict, kind: str, value: str) -> str:
        for key, mapped in mapping.items():
            if key.startswith(f"[{kind}_") and mapped == value:
                return key
        key = f"[{kind}_{1 + sum(k.startswith(f'[{kind}_') for k in mapping)}]"
        mapping[key] = value
        return key
