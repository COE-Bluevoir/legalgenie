from __future__ import annotations
import os
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .graph import build_retrieve_graph

app = FastAPI(title="LangGraph Retrieval API", version="0.1.0")

# --------- Request / Response Models ---------
class RetrieveRequest(BaseModel):
    query: str
    k: Optional[int] = 10
    kg_limit: Optional[int] = 25
    strict_match: Optional[bool] = True
    chroma_path: Optional[str] = None
    collection: Optional[str] = None
    with_answer: Optional[bool] = False
    model_path: Optional[str] = None  # local embedding model directory
    device: Optional[str] = None      # optional torch device (e.g., cpu, cuda)

class RetrievedDoc(BaseModel):
    id: str
    title: Optional[str] = None
    snippet: str
    score: Optional[float] = 0.0
    provenance: Optional[List[str]] = None
    provenance_extra: Optional[List[str]] = None

class RetrieveResponse(BaseModel):
    answer: Optional[str] = None  # placeholder for future synthesis
    docs: List[RetrievedDoc]
    source_counts: Dict[str, Any]
    chroma_available: bool
    kg_available: bool
    error: Optional[str] = None

# Precompile graph once
_retrieve_graph = build_retrieve_graph()

@app.get("/health")
async def health():
    return {"ok": True}

@app.post("/retrieve", response_model=RetrieveResponse)
async def retrieve(req: RetrieveRequest):
    if not req.query or not req.query.strip():
        raise HTTPException(status_code=400, detail="query required")

    state: Dict[str, Any] = {
        "query": req.query,
        "top_k": req.k or 10,
        "kg_limit": req.kg_limit or 25,
        "strict_match": bool(req.strict_match if req.strict_match is not None else True),
        # chroma
        "chroma_path": req.chroma_path or os.getenv("CHROMA_PATH") or ".chroma",
        "collection": req.collection or os.getenv("CHROMA_COLLECTION") or "default",
        # neo4j (optional)
        "neo4j_uri": os.getenv("NEO4J_URI", "bolt://localhost:7687"),
        "neo4j_user": os.getenv("NEO4J_USER", "neo4j"),
        "neo4j_password": os.getenv("NEO4J_PASSWORD"),
        "neo4j_database": os.getenv("NEO4J_DATABASE"),
    # embedding model (required for chroma query)
    "model_path": req.model_path or os.getenv("EMBED_MODEL_PATH") or os.getenv("MODEL_PATH"),
    "device": req.device or os.getenv("EMBED_DEVICE"),
    }

    try:
        result = _retrieve_graph.invoke(state)
    except Exception as e:  # pragma: no cover
        # Return graceful error JSON
        return RetrieveResponse(
            answer=None,
            docs=[],
            source_counts={},
            chroma_available=False,
            kg_available=False,
            error=str(e),
        )

    final_ids = result.get("final_ids", [])
    final_docs = result.get("final_docs", [])
    prov = result.get("provenance", {}) or {}
    prov_extra = result.get("provenance_extra", {}) or {}
    counts = result.get("source_counts", {}) or {}

    chroma_avail = bool(result.get("chroma_available", result.get("chroma_ids")))
    kg_avail = bool(result.get("kg_available", result.get("kg_ids")))

    docs: List[RetrievedDoc] = []
    for cid, text in zip(final_ids, final_docs):
        docs.append(RetrievedDoc(
            id=str(cid),
            title=None,
            snippet=(text or "")[:400],
            score=0.0,  # placeholder (embedding similarity not currently captured in state)
            provenance=prov.get(cid),
            provenance_extra=prov_extra.get(cid),
        ))

    answer: Optional[str] = None
    if req.with_answer and docs:
        # Build prompt
        top_docs = docs[: min(len(docs), int(os.getenv("ANSWER_TOP", "6")))]
        max_chars = int(os.getenv("ANSWER_MAX_CHARS", "4000"))
        prompt_parts = []
        total = 0
        for i, d in enumerate(top_docs, start=1):
            snippet = (d.snippet or "").replace("\n", " ").strip()
            snippet = snippet[:400]
            seg = f"[{i}] {snippet}"
            if total + len(seg) > max_chars: break
            prompt_parts.append(seg); total += len(seg)
        context_block = "\n".join(prompt_parts)
        user_q = req.query.strip()
        template = (
            "You are a legal research assistant. Using ONLY the numbered context excerpts, answer the question.\n"
            "If the answer cannot be determined from the excerpts, say you cannot determine.\n\n"
            f"Question: {user_q}\n\nContext:\n{context_block}\n\nAnswer:" )
        try:
            from transformers import pipeline
            model_name = os.getenv("ANSWER_MODEL", "google/flan-t5-base")
            pipe = pipeline("text2text-generation", model=model_name)
            gen = pipe(
                template,
                max_new_tokens=int(os.getenv("ANSWER_MAX_NEW_TOKENS", "256")),
                temperature=float(os.getenv("ANSWER_TEMPERATURE", "0")),
            )
            raw_ans = gen[0]['generated_text'].strip()
            if "[1]" not in raw_ans and len(top_docs) > 1:
                src_nums = ",".join(str(i+1) for i in range(len(top_docs)))
                raw_ans += f"\n\nSources: {src_nums}"
            answer = raw_ans
        except Exception as e:  # pragma: no cover
            answer = None
            counts['answer_error'] = str(e)

    return RetrieveResponse(
        answer=answer,
        docs=docs,
        source_counts=counts,
        chroma_available=chroma_avail,
        kg_available=kg_avail,
    )

# Convenience GET for quick manual testing: /retrieve?q=your+question&k=5
@app.get("/retrieve", response_model=RetrieveResponse)
async def retrieve_get(q: str, k: int = 10):
    payload = RetrieveRequest(query=q, k=k)
    return await retrieve(payload)  # reuse logic

# Optional root redirect
@app.get("/")
async def root():
    return {"message": "LangGraph Retrieval API. POST /retrieve"}
