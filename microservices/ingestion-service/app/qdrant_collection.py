"""QD-01: Qdrant behind the same calls as a Chroma collection, so no caller changes.

Chosen by `VECTOR_STORE=qdrant` in retrieval_config.py `vector_collection()`. Called by search,
indexing, relabelling and deletion through the methods Chroma's Collection has (get, query, upsert,
update, delete, count). Must stay identical to the copy in the other service: rag-service and
ingestion-service each ship this file (tests/test_qdrant_collection.py checks they match).
"""

import re
import uuid
import weakref

from qdrant_client import QdrantClient, models
from qdrant_client.http.exceptions import UnexpectedResponse

# A Qdrant point id must be an integer or a UUID; Chroma's are free text ("<doc>:<n>"). uuid5 is
# a fixed fingerprint of the text, so the same passage always lands on the same point.
_NAMESPACE = uuid.UUID("6f1d2c1e-5c1a-4d0b-9a8e-0d3c9b7a4e21")
# Payload keys this adapter adds next to the passage's metadata.
_ID, _DOC = "_id", "_document"
_RANGES = {"$gt": "gt", "$gte": "gte", "$lt": "lt", "$lte": "lte"}


def point_id(chroma_id: str) -> str:
    """The Qdrant point id for a Chroma passage id."""
    return str(uuid.uuid5(_NAMESPACE, chroma_id))


def _field(key: str, op: str, value) -> models.Filter | models.Condition:
    match op:
        case "$eq":
            return models.FieldCondition(key=key, match=models.MatchValue(value=value))
        case "$in":
            return models.FieldCondition(key=key, match=models.MatchAny(any=list(value)))
        # As in Chroma 1.5.5, $ne and $nin also match a passage without the key: a passage
        # indexed before the status label existed stays searchable (retriever.label_filter).
        case "$ne":
            return models.Filter(must_not=[_field(key, "$eq", value)])
        case "$nin":
            return models.Filter(must_not=[_field(key, "$in", value)])
        case _ if op in _RANGES:
            return models.FieldCondition(key=key, range=models.Range(**{_RANGES[op]: value}))
    # Never drop a filter it cannot read: a withdrawn document would then be searchable.
    raise ValueError(f"Unsupported vector filter operator: {op}")


def to_filter(where: dict | None) -> models.Filter | None:
    """A Chroma `where` dict as a Qdrant Filter, or None; raises on an unknown operator."""
    if not where:
        return None
    must = []
    for key, value in where.items():
        if key == "$and":
            must += [to_filter(part) for part in value]
        elif key == "$or":
            must.append(models.Filter(should=[to_filter(part) for part in value]))
        elif isinstance(value, dict):
            must += [_field(key, op, v) for op, v in value.items()]
        else:
            must.append(_field(key, "$eq", value))
    return models.Filter(must=must)


# The labels every search filters on. Indexed so filters stay fast, and because a Qdrant Cloud
# cluster in strict mode refuses a filter on a field with no index.
_INDEXED = (
    "doc_id",
    "status",
    "source_type",
    "jurisdiction",
    "facility_type",
    "section",
    "section_id",
    "table_id",
)
# A strict cluster's refusal names the field it wants indexed.
_MISSING_INDEX = re.compile(r'Index required but not found for \\?"([^"\\]+)')
# Collections already checked, per client. Weak, so a closed client's entry goes with it (an
# id() could be reused by a new client and skip its check).
_ready: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()


def _ensure(client: QdrantClient, name: str, dimension: int) -> None:
    """Creates the collection (cosine, like Chroma's) and its label indexes, once per process.

    Without the once-only check every search would cost a round trip to ask if it exists.
    """
    if name in _ready.get(client, ()):
        return
    if not client.collection_exists(name):
        client.create_collection(
            name,
            vectors_config=models.VectorParams(size=dimension, distance=models.Distance.COSINE),
        )
    for field in _INDEXED:
        # `position` is an integer: retriever._around matches neighbours by number.
        client.create_payload_index(name, field, models.PayloadSchemaType.KEYWORD)
    client.create_payload_index(name, "position", models.PayloadSchemaType.INTEGER)
    _ready.setdefault(client, set()).add(name)


class QdrantCollection:
    """A Qdrant collection answering the Chroma Collection calls this codebase makes."""

    def __init__(self, client: QdrantClient, name: str, dimension: int = 1024):
        _ensure(client, name, dimension)
        self.client, self.name = client, name
        # Chroma pages by number (offset=300); Qdrant by the last point read. The next page's
        # point is remembered per filter, so reading every page is one pass, not a rescan each time.
        self._next: dict[tuple[str, int], object] = {}

    # -- writing ---------------------------------------------------------------------------
    def upsert(self, ids, embeddings, documents=None, metadatas=None):
        """Adds or replaces passages by id (safe to repeat)."""
        documents = documents or [None] * len(ids)
        metadatas = [m or {} for m in metadatas or [None] * len(ids)]
        points = [
            models.PointStruct(
                id=point_id(i),
                vector=list(vector),
                payload={**meta, _ID: i, _DOC: doc},
            )
            for i, vector, doc, meta in zip(ids, embeddings, documents, metadatas)
        ]
        self.client.upsert(self.name, points=points, wait=True)

    def update(self, ids, metadatas):
        """Merges new metadata into each passage, as Chroma does; the vector is kept.

        Selected by filter, not by id, so a passage deleted meanwhile is skipped as Chroma skips
        it; by id, Qdrant would fail the whole relabel.
        """
        self.client.batch_update_points(
            self.name,
            [
                models.SetPayloadOperation(
                    set_payload=models.SetPayload(
                        payload=meta,
                        filter=models.Filter(must=[models.HasIdCondition(has_id=[point_id(i)])]),
                    )
                )
                for i, meta in zip(ids, metadatas)
            ],
            wait=True,
        )

    def delete(self, ids):
        """Removes passages by id."""
        self.client.delete(
            self.name, models.PointIdsList(points=[point_id(i) for i in ids]), wait=True
        )

    # -- reading ---------------------------------------------------------------------------
    def count(self) -> int:
        """The number of passages stored."""
        return self.client.count(self.name, exact=True).count

    def get(self, ids=None, where=None, include=("metadatas", "documents"), limit=None, offset=0):
        """Passages by id or by filter, as Chroma returns them ({ids, documents, metadatas})."""
        vectors = "embeddings" in include
        if ids is not None:
            found = self.client.retrieve(
                self.name, [point_id(i) for i in ids], with_payload=True, with_vectors=vectors
            )
            by_id = {p.payload[_ID]: p for p in found}
            points = [by_id[i] for i in ids if i in by_id]
        else:
            points = self._page(to_filter(where), limit, offset or 0, vectors)
        return self._shape(points, include)

    def _indexed(self, call):
        """Runs a filtered read; if a strict cluster wants a field indexed, indexes it and retries.

        Chat builds some filters at run time, so a fixed index list could miss a key; without
        this the cloud cluster would refuse that search outright.
        """
        try:
            return call()
        except UnexpectedResponse as error:
            found = _MISSING_INDEX.search((error.content or b"").decode(errors="replace"))
            if not found:
                raise
            self.client.create_payload_index(
                self.name, found.group(1), models.PayloadSchemaType.KEYWORD
            )
            return call()

    def _page(self, flt, limit, offset, vectors):
        key = repr(flt)
        start = self._next.get((key, offset)) if offset else None
        skip = offset if offset and start is None else 0
        points, after = [], start
        want = (limit or 10_000_000) + skip
        while len(points) < want:
            batch, after = self._indexed(
                lambda: self.client.scroll(
                    self.name,
                    scroll_filter=flt,
                    limit=min(want - len(points), 1000),
                    offset=after,
                    with_payload=True,
                    with_vectors=vectors,
                )
            )
            points += batch
            if after is None:
                break
        points = points[skip:]
        if limit and after is not None:
            self._next[(key, offset + len(points))] = after
        return points

    def query(self, query_embeddings, n_results=10, where=None, include=None):
        """Nearest passages for each query vector, as Chroma returns them (lists of lists).

        Chroma's cosine distance is 1 - similarity, and Qdrant's score is the similarity, so the
        distances (and every threshold built on them) stay the same.
        """
        include = include or ("metadatas", "documents", "distances")
        flt = to_filter(where)
        answers = self._indexed(
            lambda: self.client.query_batch_points(
                self.name,
                [
                    models.QueryRequest(
                        query=list(v), filter=flt, limit=n_results, with_payload=True
                    )
                    for v in query_embeddings
                ],
            )
        )
        shaped = [self._shape(a.points, include) for a in answers]
        out = {k: [s[k] for s in shaped] for k in ("ids", "documents", "metadatas")}
        out["distances"] = [[1 - p.score for p in a.points] for a in answers]
        return out

    @staticmethod
    def _shape(points, include):
        return {
            "ids": [p.payload[_ID] for p in points],
            "documents": [p.payload.get(_DOC) for p in points] if "documents" in include else None,
            "metadatas": (
                [{k: v for k, v in p.payload.items() if k not in (_ID, _DOC)} for p in points]
                if "metadatas" in include
                else None
            ),
            "embeddings": [p.vector for p in points] if "embeddings" in include else None,
        }
