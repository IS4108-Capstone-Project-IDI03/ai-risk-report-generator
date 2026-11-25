"""QD-01: does Qdrant return the same top-5 passages as Chroma? Run once before cut-over.

Embeds each golden question once (Cohere, so it costs a little), asks both stores the same
question with the same filter, and prints a markdown table. Read-only on both stores.
Run: `cd microservices/rag-service && uv run python -m eval.vector_parity`
Needs the Chroma env (CHROMA_*) and QDRANT_URL (+ QDRANT_API_KEY) of the two stores.
"""

import json
from pathlib import Path

from app.qdrant_collection import QdrantCollection
from app.retrieval.retriever import label_filter
from app.retrieval_config import (
    COLLECTION,
    EMBEDDING_DIMENSION,
    EMBEDDING_MODEL,
    chroma_client,
    cohere_client,
    qdrant_client,
)

QUESTIONS = Path(__file__).with_name("vector_parity_questions.json")
TOP = 5
PASS_AT = 0.9


def embed(questions: list[str]) -> list[list[float]]:
    """One Cohere call for every question, the same way retriever.search embeds a query."""
    return (
        cohere_client()
        .embed(
            model=EMBEDDING_MODEL,
            texts=questions,
            input_type="search_query",
            embedding_types=["float"],
            output_dimension=EMBEDDING_DIMENSION,
            truncate="NONE",
        )
        .embeddings.float_
    )


def top_ids(collection, vector: list[float], where: dict) -> list[str]:
    """The ids of the TOP nearest passages for the vector, under the filter."""
    found = collection.query(
        query_embeddings=[vector], n_results=TOP, where=where, include=["distances"]
    )
    return found["ids"][0]


def main() -> None:
    questions = [q["question"] for q in json.loads(QUESTIONS.read_text())]
    # Same filter as drafting: no filters, so only withdrawn and needs-review are hidden.
    where = label_filter({})
    chroma = chroma_client().get_collection(name=COLLECTION, embedding_function=None)
    qdrant = QdrantCollection(qdrant_client(), COLLECTION, EMBEDDING_DIMENSION)
    rows, scores = [], []
    for question, vector in zip(questions, embed(questions)):
        want, got = top_ids(chroma, vector, where), top_ids(qdrant, vector, where)
        score = len(set(want) & set(got)) / len(want) if want else 1.0
        scores.append(score)
        missing = ", ".join(sorted(set(want) - set(got))) or "-"
        rows.append(f"| {question[:70]} | {score:.0%} | {missing} |")
    print("| Question | Top-5 overlap | Missing from Qdrant |\n|---|---|---|")
    print("\n".join(rows))
    mean = sum(scores) / len(scores)
    print(f"\nMean overlap {mean:.1%} vs {PASS_AT:.0%}: {'PASS' if mean >= PASS_AT else 'FAIL'}")


if __name__ == "__main__":
    main()
