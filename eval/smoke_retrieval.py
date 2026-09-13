"""Live check: services must be running with a valid Cohere key.

Sends synthetic text to Cohere and upserts two fixed demo chunk IDs in Chroma.
Run from the repo root: python3 eval/smoke_retrieval.py
"""

import json
from urllib.request import Request, urlopen


def post(url: str, body: dict) -> dict:
    request = Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urlopen(request, timeout=90) as response:
        return json.load(response)


def main():
    metadata = {
        "document_id": "a2603-smoke",
        "source_type": "synthetic",
        "jurisdiction": "SG",
        "facility_type": "warehouse",
        "COPE_dimension": "Protection",
        "effective_date": "2026-09-13",
        "page": 1,
    }
    chunks = [
        {
            "id": "a2603-smoke:flood",
            "text": "The A2603 demo warehouse uses flood barriers at every entrance.",
            "metadata": metadata,
        },
        {
            "id": "a2603-smoke:fire",
            "text": "The A2603 demo warehouse has fire extinguishers inspected monthly.",
            "metadata": metadata,
        },
    ]
    indexed = post("http://localhost:8001/index", {"chunks": chunks})
    assert indexed["chunks_indexed"] == 2, indexed
    results = post(
        "http://localhost:8002/retrieve",
        {"query": "What flood protection does the A2603 demo warehouse have?"},
    )["results"]
    assert any(result["id"] == "a2603-smoke:flood" for result in results), results
    assert all(
        "relevance_score" in result and "metadata" in result for result in results
    )
    print("PASS: Cohere embedding -> Chroma indexing/search -> Cohere reranking")


if __name__ == "__main__":
    main()
