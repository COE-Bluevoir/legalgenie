from __future__ import annotations
import json
import os
from datetime import datetime, timezone
from typing import List, Dict, Any
import unicodedata
import re

from docx import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from .types import SplitterConfig, Chunk, PipelineInput, PipelineOutput
import tempfile
from .legal_normalizer import normalize_legal_entity, phonetic_key


# --------------------- Canonical entity key helpers ---------------------

def _normalize_label(label: str | None) -> str:
    """Normalize entity label to a canonical, deterministic form."""
    return (label or "").strip().upper()


def _normalize_text(text: str | None) -> str:
    """Normalize entity text robustly: unicode, whitespace, quotes, punctuation, casefold."""
    s = unicodedata.normalize("NFKC", text or "")
    # remove zero-width chars
    s = s.replace("\u200b", "")
    # unify curly quotes
    s = s.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    # remove legal stopwords like 'v.', 'vs.' (whole-word, case-insensitive)
    s = re.sub(r"\b(vs?\.)\b", " ", s, flags=re.IGNORECASE)
    # collapse sequences of initials like 'S. K.' or abbreviations like 'V.R.' -> 'sk', 'vr'
    def _collapse_initials(m: re.Match) -> str:
        letters = re.findall(r"[A-Za-z]", m.group(0))
        return "".join(letters)
    s = re.sub(r"\b(?:[A-Za-z]\.?\s*){2,}\b", _collapse_initials, s)
    # collapse whitespace
    s = re.sub(r"\s+", " ", s).strip()
    # trim common edge punctuation (keep internal punctuation)
    s = s.strip(" .,:;()[]{}\"'\u00A0")
    # casefold for robust lowercase across locales
    s = s.casefold()
    return s


def make_entity_key(label: str | None, text: str | None) -> str:
    """Compute canonical key LABEL|text for strict matching."""
    return f"{_normalize_label(label)}|{_normalize_text(text)}"


# --------------------- Domain keyword augmentation ---------------------

# Map keyword -> label. Extend as needed.
KEYWORD_ENTITY_MAP: Dict[str, str] = {
    "court": "ORG",
}

def _augment_entities_with_keywords(text: str, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Add keyword-based entities if not already present by normalized text (case-insensitive, whole word)."""
    entities = entities or []
    existing_norm = { _normalize_text(e.get("text")) for e in entities if e.get("text") }
    s = text or ""
    for kw, label in KEYWORD_ENTITY_MAP.items():
        for m in re.finditer(rf"(?i)(?<!\w){re.escape(kw)}(?!\w)", s):
            span = m.group(0)
            norm = _normalize_text(span)
            if norm in existing_norm:
                continue
            entities.append({
                "label": label,
                "text": span,
                "start": m.start(),
                "end": m.end(),
                "score": 1.0,
                "_augmented": True,
            })
            existing_norm.add(norm)
            break  # add at most one occurrence per keyword
    return entities


def _read_docx_text(path: str) -> str:
    doc = Document(path)
    # Join paragraphs; skip empties
    paragraphs = [p.text for p in doc.paragraphs if p.text and p.text.strip()]
    return "\n\n".join(paragraphs)


def load_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Load .docx into a raw text string and basic metadata."""
    input_path = state["input_path"]
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file not found: {input_path}")

    raw_text = _read_docx_text(input_path)
    metadata = {
        "source_path": os.path.abspath(input_path),
        "doc_id": os.path.splitext(os.path.basename(input_path))[0],
        # Use timezone-aware UTC timestamp (avoid deprecated utcnow())
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    # Propagate config and paths so subsequent nodes can access them
    return {
        "raw_text": raw_text,
        "metadata": metadata,
        "config": state.get("config"),
        "input_path": input_path,
        "output_path": state.get("output_path"),
    }


def split_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Split raw text into chunks using LangChain."""
    raw_text: str = state["raw_text"]
    cfg: Dict[str, Any] = state.get("config") or {}

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=cfg.get("chunk_size", 1200),
        chunk_overlap=cfg.get("chunk_overlap", 200),
        separators=cfg.get("separators", None),
    )

    texts: List[str] = text_splitter.split_text(raw_text)
    total = len(texts)

    base_meta: Dict[str, Any] = state.get("metadata", {}).copy()
    base_meta["splitter_config"] = {
        "chunk_size": cfg.get("chunk_size", 1200),
        "chunk_overlap": cfg.get("chunk_overlap", 200),
        "separators": cfg.get("separators"),
    }

    chunks: List[Chunk] = []
    for i, t in enumerate(texts):
        meta = base_meta.copy()
        meta.update({
            "chunk_id": i,
            "chunk_index": i,
            "total_chunks": total,
        })
        chunks.append(Chunk(text=t, metadata=meta))

    # Propagate forward
    return {
        "chunks": chunks,
        "metadata": state["metadata"],
        "config": cfg,
        "input_path": state.get("input_path"),
        "output_path": state.get("output_path"),
    }


def save_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Save chunks into JSONL file with metadata (one object per line)."""
    input_path = state["input_path"]
    output_path = state.get("output_path")
    chunks: List[Chunk] = state["chunks"]

    if not output_path:
        base, _ = os.path.splitext(input_path)
        output_path = base + ".chunks.jsonl"

    # Enforce .jsonl extension
    if not output_path.lower().endswith(".jsonl"):
        output_path = os.path.splitext(output_path)[0] + ".jsonl"

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        for c in chunks:
            json.dump({"text": c.text, "metadata": c.metadata}, f, ensure_ascii=False)
            f.write("\n")

    # Return output path and keep chunks for potential downstream use
    return {
        "output_path": output_path,
        "chunks": chunks,
        "metadata": state.get("metadata"),
        "config": state.get("config"),
        "input_path": input_path,
    }


# --------------------- JSON pipeline nodes ---------------------

def load_json_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Load a JSON file with structure: {"results": [{"id":..., "doc":...}, ...]}"""
    input_path = state["input_path"]
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file not found: {input_path}")

    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    items = data.get("results", [])
    return {
        "items": items,
        "config": state.get("config"),
        "input_path": input_path,
        "output_path": state.get("output_path"),
    }


def split_json_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Split each item's text using LangChain. Output simple chunks list."""
    items = state.get("items", [])
    cfg: Dict[str, Any] = state.get("config", {})

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=cfg.get("chunk_size", 1000),
        chunk_overlap=cfg.get("chunk_overlap", 200),
        separators=cfg.get("separators", None),
    )

    chunks_simple: List[Dict[str, Any]] = []
    for case in items:
        case_id = case.get("id", "unknown")
        content = case.get("doc", "")
        if not content:
            continue
        splits = text_splitter.split_text(content)
        for i, split in enumerate(splits):
            chunks_simple.append({
                "case_id": case_id,
                "chunk_id": i,
                "text": split,
            })

    return {
        "chunks_simple": chunks_simple,
        "config": cfg,
        "input_path": state.get("input_path"),
        "output_path": state.get("output_path"),
    }


def save_json_simple_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Save flat list of chunks (case_id, chunk_id, text) to output JSONL."""
    input_path = state.get("input_path")
    output_path = state.get("output_path")
    chunks_simple: List[Dict[str, Any]] = state.get("chunks_simple", [])

    if not output_path:
        base, _ = os.path.splitext(input_path or "output")
        output_path = base + ".chunks.jsonl"

    # Enforce .jsonl extension
    if not output_path.lower().endswith(".jsonl"):
        output_path = os.path.splitext(output_path)[0] + ".jsonl"

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        for obj in chunks_simple:
            json.dump(obj, f, ensure_ascii=False)
            f.write("\n")

    return {
        "output_path": output_path,
        "chunks_simple": chunks_simple,
        "config": state.get("config"),
        "input_path": input_path,
    }


# --------------------- Embedding pipeline nodes ---------------------

def load_jsonl_chunks_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Read JSONL chunks produced by the splitter. Each line: {text, metadata}."""
    input_path = state.get("input_path")
    if not input_path or not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file not found: {input_path}")

    records: List[Dict[str, Any]] = []
    with open(input_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            # Expect {text, metadata}
            records.append(obj)

    return {
        "records": records,
        "model_path": state.get("model_path"),
        "batch_size": state.get("batch_size", 32),
        "device": state.get("device"),
        "input_path": input_path,
        "output_path": state.get("output_path"),
    }


def embed_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Generate embeddings using a local Hugging Face model directory."""
    import numpy as np
    import torch
    from transformers import AutoTokenizer, AutoModel

    records: List[Dict[str, Any]] = state.get("records", [])
    model_path: str | None = state.get("model_path")
    batch_size: int = int(state.get("batch_size", 32))
    device_arg = state.get("device")

    if not model_path:
        raise ValueError("model_path is required for embedding. Provide a folder containing config.json and tokenizer files.")

    # Resolve actual model directory (handles pointing at a cache root with subfolders)
    def _resolve_model_dir(root: str) -> str:
        root = os.path.abspath(root)
        cfg = os.path.join(root, "config.json")
        if os.path.isfile(cfg):
            return root

        def score_dir(d: str) -> tuple:
            score = 0
            for tf in ("tokenizer.json", "spiece.model", "vocab.txt", "tokenizer.model"):  # common tokenizer files
                if os.path.isfile(os.path.join(d, tf)):
                    score += 1
            # Prefer snapshot directories (HF cache) slightly
            if os.path.basename(os.path.dirname(d)) == "snapshots":
                score += 1
            mtime = os.path.getmtime(d)
            return (score, mtime)

        # Walk up to a few levels to handle HF cache layout: models--<repo> / snapshots / <rev>
        candidates: list[tuple[int, float, str]] = []
        max_depth = 4
        try:
            for current_root, dirs, files in os.walk(root):
                # depth limit
                rel = os.path.relpath(current_root, root)
                depth = 0 if rel == "." else rel.count(os.sep) + 1
                if depth > max_depth:
                    # prune deeper traversal
                    dirs[:] = []
                    continue
                if "config.json" in files:
                    s, m = score_dir(current_root)
                    candidates.append((s, m, current_root))
        except FileNotFoundError:
            pass

        if not candidates:
            raise FileNotFoundError(
                f"Could not find a model directory with config.json under: {root}. "
                f"Point --model-path to a folder that directly contains config.json (e.g., the 'snapshots/<rev>' directory)."
            )
        candidates.sort(key=lambda x: (x[0], x[1]), reverse=True)
        return candidates[0][2]

    model_dir = _resolve_model_dir(model_path)

    # Load model/tokenizer from resolved path (local only)
    try:
        tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
    except Exception as e:
        raise RuntimeError(f"Failed to load tokenizer from {model_dir}. Ensure tokenizer files exist (e.g., tokenizer.json or spiece.model). Original error: {e}")
    try:
        model = AutoModel.from_pretrained(model_dir, local_files_only=True)
    except Exception as e:
        raise RuntimeError(f"Failed to load model weights from {model_dir}. Ensure config.json and model weights exist. Original error: {e}")

    # Select device
    if device_arg:
        device = torch.device(device_arg)
    else:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    model.eval()

    def mean_pool(last_hidden_state: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        mask = attention_mask.unsqueeze(-1).expand(last_hidden_state.size()).float()
        masked = last_hidden_state * mask
        summed = masked.sum(dim=1)
        counts = torch.clamp(mask.sum(dim=1), min=1e-9)
        return summed / counts

    embeddings: List[Dict[str, Any]] = []
    with torch.no_grad():
        for i in range(0, len(records), batch_size):
            batch = records[i:i+batch_size]
            texts = [r.get("text", "") for r in batch]
            encoded = tokenizer(
                texts,
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors="pt",
            )
            encoded = {k: v.to(device) for k, v in encoded.items()}
            outputs = model(**encoded)
            # Use last_hidden_state mean pooling
            last_hidden = outputs.last_hidden_state
            pooled = mean_pool(last_hidden, encoded["attention_mask"])  # (B, H)
            # L2 normalize
            pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)

            vecs = pooled.cpu().numpy().astype(np.float32)
            for rec, vec in zip(batch, vecs):
                embeddings.append({
                    "text": rec.get("text"),
                    "metadata": rec.get("metadata", {}),
                    "embedding": vec.tolist(),
                })

    return {
        "embeddings": embeddings,
        "input_path": state.get("input_path"),
        "output_path": state.get("output_path"),
        "model_path": model_path,
        "batch_size": batch_size,
        "device": str(device),
    }


def save_embeddings_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Save embeddings JSONL: {text, metadata, embedding[]} per line."""
    input_path = state.get("input_path")
    output_path = state.get("output_path")
    records = state.get("embeddings", [])

    if not output_path:
        base, _ = os.path.splitext(input_path or "output")
        output_path = base + ".embeddings.jsonl"

    if not output_path.lower().endswith(".jsonl"):
        output_path = os.path.splitext(output_path)[0] + ".jsonl"

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        for obj in records:
            json.dump(obj, f, ensure_ascii=False)
            f.write("\n")

    return {
        "output_path": output_path,
        "embeddings": records,
        "model_path": state.get("model_path"),
        "batch_size": state.get("batch_size"),
        "device": state.get("device"),
    }


# --------------------- Vector store (ChromaDB) nodes ---------------------

def load_embeddings_jsonl_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Load embeddings JSONL: {text, metadata, embedding[]} per line."""
    input_path = state.get("input_path")
    if not input_path or not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file not found: {input_path}")
    items: List[Dict[str, Any]] = []
    with open(input_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if not obj.get("embedding"):
                continue
            items.append(obj)
    return {
        "items": items,
        "chroma_path": state.get("chroma_path"),
        "collection": state.get("collection", "default"),
        "batch_size": state.get("batch_size", 128),
        "input_path": input_path,
    }


def chroma_upsert_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Upsert embeddings into ChromaDB collection."""
    from chromadb import PersistentClient

    items: List[Dict[str, Any]] = state.get("items", [])
    chroma_path = state.get("chroma_path") or ".chroma"
    collection_name = state.get("collection") or "default"
    batch_size: int = int(state.get("batch_size", 128))

    os.makedirs(chroma_path, exist_ok=True)
    client = PersistentClient(path=chroma_path)
    coll = client.get_or_create_collection(name=collection_name)

    def gen_id(meta: Dict[str, Any]) -> str:
        # Use doc_id + chunk_id if present; fallback to index
        doc = str(meta.get("doc_id", "doc"))
        cid = str(meta.get("chunk_id", "0"))
        return f"{doc}:{cid}"

    def normalize_metadata(meta: Dict[str, Any]) -> Dict[str, Any]:
        # Chroma requires scalar values: str, int, float, bool, or None
        out: Dict[str, Any] = {}
        for k, v in (meta or {}).items():
            if isinstance(v, (str, int, float, bool)) or v is None:
                out[str(k)] = v
            else:
                # Convert dicts/lists/others to JSON string
                try:
                    out[str(k)] = json.dumps(v, ensure_ascii=False)
                except Exception:
                    out[str(k)] = str(v)
        return out

    total = 0
    for i in range(0, len(items), batch_size):
        batch = items[i:i+batch_size]
        ids = [gen_id(x.get("metadata", {})) for x in batch]
        embeddings = [x["embedding"] for x in batch]
        documents = [x.get("text", "") for x in batch]
        metadatas = [normalize_metadata(x.get("metadata", {})) for x in batch]
        coll.upsert(ids=ids, embeddings=embeddings, documents=documents, metadatas=metadatas)
        total += len(batch)

    return {
        "upserted": total,
        "chroma_path": chroma_path,
        "collection": collection_name,
    }


# --------------------- NER pipeline (external env) nodes ---------------------

def load_jsonl_for_ner_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Load JSONL chunks (or any text records) for NER. Pass through paths/options."""
    input_path = state.get("input_path")
    if not input_path or not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file not found: {input_path}")
    return {
        "input_path": input_path,
        "output_path": state.get("output_path"),
    "framework": state.get("framework", "spacy"),
    "spacy_model": state.get("spacy_model", "en_legal_ner_trf"),
    "ner_model_path": state.get("ner_model_path"),
        "ner_env": state.get("ner_env", "ner_env"),
        "batch_size": state.get("batch_size", 16),
        "device": state.get("device", "cpu"),
        "aggregation": state.get("aggregation", "simple"),
    }


def run_ner_external_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Invoke the ner_runner.py in a different conda env (ner_env) via subprocess/conda run."""
    import subprocess
    input_path = state["input_path"]
    output_path = state.get("output_path")
    if not output_path:
        base, _ = os.path.splitext(input_path)
        output_path = base + ".ner.jsonl"

    framework = state.get("framework", "spacy")
    spacy_model = state.get("spacy_model", "en_legal_ner_trf")
    ner_model_path = state.get("ner_model_path")
    if framework == "transformers" and not ner_model_path:
        raise ValueError("--ner-model-path is required when --framework=transformers")

    ner_env = state.get("ner_env", "ner_env")
    batch_size = str(state.get("batch_size", 16))
    device = state.get("device", "cpu")
    aggregation = state.get("aggregation", "simple")

    # Prefer conda run to activate env and execute module
    cmd = [
        "conda", "run", "-n", ner_env,
        "python", "-m", "app.ner_runner",
        "--input", input_path,
        "--output", output_path,
        "--framework", framework,
    ]
    if framework == "spacy":
        cmd += ["--spacy-model", spacy_model, "--batch-size", batch_size]
        # Provide optional embedding model for fallback statute similarity
        model_path = state.get("model_path") or state.get("embed_model_path")
        if model_path:
            cmd += ["--embed-model-path", model_path]
    else:
        cmd += [
            "--model-path", ner_model_path,
        "--batch-size", batch_size,
        "--device", device,
        "--aggregation", aggregation,
        ]
    try:
        subprocess.run(cmd, check=True)
    except FileNotFoundError:
        # Fallback: try activating via powershell - this is environment specific, so we document primary path above
        raise RuntimeError("'conda' not found. Please ensure Conda is installed and available on PATH.")
    return {
        "output_path": output_path,
    "framework": framework,
    "spacy_model": spacy_model,
    "ner_model_path": ner_model_path,
        "ner_env": ner_env,
    }


# --------------------- Neo4j KG ingest nodes ---------------------

def load_ner_jsonl_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Load NER JSONL: {text, metadata, entities[]} per line."""
    input_path = state.get("input_path")
    if not input_path or not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file not found: {input_path}")

    items: List[Dict[str, Any]] = []
    with open(input_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            # ensure structure
            if not isinstance(obj, dict) or "entities" not in obj:
                continue
            items.append(obj)

    return {
        "items": items,
        "neo4j_uri": state.get("neo4j_uri", "bolt://localhost:7687"),
        "neo4j_user": state.get("neo4j_user", "neo4j"),
        "neo4j_password": state.get("neo4j_password"),
        "neo4j_database": state.get("neo4j_database"),
        "batch_size": int(state.get("batch_size", 1000)),
        "input_path": input_path,
    }


def neo4j_ingest_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Upsert NER results into Neo4j: Document, Chunk, Entity nodes and MENTIONS relationships."""
    from neo4j import GraphDatabase

    items: List[Dict[str, Any]] = state.get("items", [])
    uri = state.get("neo4j_uri", "bolt://localhost:7687")
    user = state.get("neo4j_user", "neo4j")
    password = state.get("neo4j_password")
    database = state.get("neo4j_database")
    batch_size: int = int(state.get("batch_size", 1000))

    if not password:
        raise ValueError("neo4j_password is required")

    driver = GraphDatabase.driver(uri, auth=(user, password))
    processed = 0
    try:
        def run_session(tx_func):
            if database:
                with driver.session(database=database) as session:
                    return session.execute_write(tx_func)
            else:
                with driver.session() as session:
                    return session.execute_write(tx_func)

        # Create constraints (id keys for stability)
        def create_constraints(tx):
            tx.run("CREATE CONSTRAINT IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE")
            tx.run("CREATE CONSTRAINT IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE")
            tx.run("CREATE CONSTRAINT IF NOT EXISTS FOR (e:Entity) REQUIRE e.key IS UNIQUE")

        run_session(create_constraints)

        # Prepare rows (one per entity) and alias rows
        rows: List[Dict[str, Any]] = []
        alias_rows: List[Dict[str, Any]] = []
        for obj in items:
            meta = obj.get("metadata", {}) or {}
            ents = obj.get("entities", []) or []
            # Augment with domain keywords using the chunk text on this line, if present
            src_text = obj.get("text") or ""
            ents = _augment_entities_with_keywords(src_text, ents)
            if not ents:
                continue
            doc_id = str(meta.get("doc_id", "unknown"))
            chunk_id = str(meta.get("chunk_id", "0"))
            chunk_index = meta.get("chunk_index")
            total_chunks = meta.get("total_chunks")
            source_path = meta.get("source_path")
            chunk_uid = f"{doc_id}:{chunk_id}"
            for e in ents:
                label = str(e.get("label", ""))
                entity_text = str(e.get("text", "")).strip()
                if not entity_text:
                    continue
                # coerce start/end to ints to avoid null properties in MERGE key
                try:
                    start = int(e.get("start", 0))
                except Exception:
                    start = 0
                try:
                    end = int(e.get("end", start))
                except Exception:
                    end = start
                score = e.get("score")
                source = e.get("source") or None
                entity_key = make_entity_key(label, entity_text)
                norm_text = normalize_legal_entity(entity_text)
                norm_key = make_entity_key(label, norm_text)
                rows.append({
                    "doc_id": doc_id,
                    "source_path": source_path,
                    "chunk_id": chunk_id,
                    "chunk_index": chunk_index,
                    "total_chunks": total_chunks,
                    "chunk_uid": chunk_uid,
                    "label": label,
                    "entity_text": entity_text,
                    "entity_norm_text": norm_text,
                    "entity_key": entity_key,
                    "entity_norm_key": norm_key,
                    "start": start,
                    "end": end,
                    "score": score,
                    "source": source,
                })
                # Build aliases for the entity_text (normalized variants)
                norm = norm_text
                if norm:
                    alias_rows.append({"entity_key": entity_key, "alias": norm})
                # Also include a cleaned alias without numeric suffixes (footnotes) if any
                cleaned_alias = re.sub(r"\d+$", "", normalize_legal_entity(entity_text))
                if cleaned_alias and cleaned_alias != norm:
                    alias_rows.append({"entity_key": entity_key, "alias": cleaned_alias})
                parts = [p for p in re.split(r"\b(?:v|vs)\.?\b", norm) if p]
                for p in parts:
                    alias = normalize_legal_entity(p)
                    if alias:
                        alias_rows.append({"entity_key": entity_key, "alias": alias})
                combo = normalize_legal_entity(" ".join([p.strip() for p in re.split(r"\b(?:v|vs)\.?\b", entity_text, flags=re.IGNORECASE)]))
                if combo:
                    alias_rows.append({"entity_key": entity_key, "alias": combo})
                # phonetic alias for cross-spelling tolerance
                ph = phonetic_key(norm)
                if ph:
                    alias_rows.append({"entity_key": entity_key, "alias_phonetic": ph})

        if not rows:
            return {
                "ingested": 0,
                "neo4j_uri": uri,
                "neo4j_user": user,
            }

        cypher = (
            "UNWIND $rows AS row "
            "MERGE (d:Document {id: row.doc_id}) "
            "ON CREATE SET d.source_path = row.source_path "
            "MERGE (c:Chunk {id: row.chunk_uid}) "
            "ON CREATE SET c.doc_id = row.doc_id, c.chunk_id = row.chunk_id, c.chunk_index = row.chunk_index, c.total_chunks = row.total_chunks "
            "MERGE (d)-[:HAS_CHUNK]->(c) "
            "MERGE (e:Entity {key: row.entity_key}) "
            "ON CREATE SET e.label = row.label, e.text = row.entity_text, e.norm_text = row.entity_norm_text, e.norm_key = row.entity_norm_key "
            "SET e.norm_key = coalesce(e.norm_key, row.entity_norm_key), e.norm_text = coalesce(e.norm_text, row.entity_norm_text) "
            "MERGE (c)-[m:MENTIONS {start: row.start, end: row.end}]->(e) "
            "SET m.score = row.score, m.source = row.source"
        )

        for i in range(0, len(rows), batch_size):
            batch = rows[i:i+batch_size]
            def ingest_tx(tx):
                tx.run(cypher, rows=batch)
            run_session(ingest_tx)
            processed += len(batch)

        # Insert aliases after entities exist
        if alias_rows:
            cypher_alias = (
                "UNWIND $alias_rows AS a "
                "MATCH (e:Entity {key: a.entity_key}) "
                "FOREACH (_ IN CASE WHEN coalesce(a.alias,'') <> '' THEN [1] ELSE [] END | "
                "  MERGE (al:Alias {name: a.alias})-[:ALIAS_OF]->(e) ) "
                "FOREACH (_ IN CASE WHEN coalesce(a.alias_phonetic,'') <> '' THEN [1] ELSE [] END | "
                "  MERGE (pl:PhoneticAlias {code: a.alias_phonetic})-[:PHONETIC_OF]->(e) )"
            )
            def alias_tx(tx):
                tx.run(cypher_alias, alias_rows=alias_rows)
            run_session(alias_tx)
    finally:
        driver.close()

    return {
        "ingested": processed,
        "neo4j_uri": uri,
        "neo4j_user": user,
    }


# --------------------- Retrieval pipeline nodes ---------------------

def prepare_query_node(state: Dict[str, Any]) -> Dict[str, Any]:
    query = state.get("query")
    if not query or not isinstance(query, str):
        raise ValueError("A non-empty --query string is required for retrieve mode")
    return {
        "query": query,
        "output_path": state.get("output_path") or "retrieved.txt",
        "framework": state.get("framework", "spacy"),
        "spacy_model": state.get("spacy_model", "en_legal_ner_trf"),
        "ner_env": state.get("ner_env", "ner_env"),
        "model_path": state.get("model_path"),
        "device": state.get("device"),
        "top_k": int(state.get("top_k", 10)),
        "kg_limit": int(state.get("kg_limit", 25)),
        "chroma_path": state.get("chroma_path") or ".chroma",
        "collection": state.get("collection") or "default",
        "neo4j_uri": state.get("neo4j_uri", "bolt://localhost:7687"),
        "neo4j_user": state.get("neo4j_user", "neo4j"),
        "neo4j_password": state.get("neo4j_password"),
    "neo4j_database": state.get("neo4j_database"),
    "strict_match": state.get("strict_match", False),
    }


def ner_query_external_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Run NER on the query using ner_env and return extracted entities (label|text keys)."""
    import subprocess
    query: str = state["query"]
    framework = state.get("framework", "spacy")
    spacy_model = state.get("spacy_model", "en_legal_ner_trf")
    ner_env = state.get("ner_env", "ner_env")

    # Write a temporary input JSONL with one record
    tmp_in = tempfile.NamedTemporaryFile(delete=False, suffix=".jsonl")
    tmp_out = tempfile.NamedTemporaryFile(delete=False, suffix=".jsonl")
    tmp_in.close(); tmp_out.close()
    with open(tmp_in.name, "w", encoding="utf-8") as f:
        json.dump({"text": query, "metadata": {}}, f, ensure_ascii=False)
        f.write("\n")

    cmd = [
        "conda", "run", "-n", ner_env,
        "python", "-m", "app.ner_runner",
        "--input", tmp_in.name,
        "--output", tmp_out.name,
        "--framework", framework,
        "--spacy-model", spacy_model,
        "--batch-size", "1",
    ]
    try:
        subprocess.run(cmd, check=True)
    except FileNotFoundError:
        raise RuntimeError("'conda' not found. Ensure Conda is on PATH.")

    import logging
    log = logging.getLogger("nlp")
    entities = []
    any_ruler = False
    with open(tmp_out.name, "r", encoding="utf-8") as f:
        line = f.readline()
        if line:
            obj = json.loads(line)
            ents = obj.get("entities", []) or []
            # Augment with domain keywords like "court"
            ents = _augment_entities_with_keywords(query, ents)
            for e in ents:
                text = (e.get("text") or "").strip()
                label = e.get("label") or ""
                if text:
                    key = make_entity_key(label, text)
                    source = e.get("source")
                    if source == "ruler":
                        any_ruler = True
                        try:
                            log.info(f"[EntityRuler regex hit] query entity: {text} -> normalized: {normalize_legal_entity(text)}")
                        except Exception:
                            pass
                    entities.append({
                        "label": str(label),
                        "text": text,
                        "key": key,
                        "source": source,
                    })

    # Cleanup temp files
    try:
        os.remove(tmp_in.name)
        os.remove(tmp_out.name)
    except Exception:
        pass

    # Return merged state since retrieve graph is serialized; preserve prior keys like 'query'
    return {**state, "query_entities": entities, "query_has_ruler": any_ruler}


def chroma_query_by_embedding_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Compute embedding for the query and retrieve top_k similar chunks from Chroma.
    Adds availability flags and captures chroma_ids.
    """
    import numpy as np
    import torch
    from transformers import AutoTokenizer, AutoModel
    from chromadb import PersistentClient

    try:
        query: str = state["query"]
        model_path: str | None = state.get("model_path")
        if not model_path:
            raise ValueError("--model-path is required to compute query embedding for retrieval")

        # Reuse resolver from embed_node
        def _resolve_model_dir(root: str) -> str:
            root = os.path.abspath(root)
            cfg = os.path.join(root, "config.json")
            if os.path.isfile(cfg):
                return root
            candidates = []
            for current_root, dirs, files in os.walk(root):
                rel = os.path.relpath(current_root, root)
                depth = 0 if rel == "." else rel.count(os.sep) + 1
                if depth > 4:
                    dirs[:] = []
                    continue
                if "config.json" in files:
                    score = 0
                    for tf in ("tokenizer.json", "spiece.model", "vocab.txt", "tokenizer.model"):
                        if os.path.isfile(os.path.join(current_root, tf)):
                            score += 1
                    mtime = os.path.getmtime(current_root)
                    candidates.append((score, mtime, current_root))
            if not candidates:
                raise FileNotFoundError(f"Could not find config.json under: {root}")
            candidates.sort(key=lambda x: (x[0], x[1]), reverse=True)
            return candidates[0][2]

        model_dir = _resolve_model_dir(model_path)
        tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
        model = AutoModel.from_pretrained(model_dir, local_files_only=True)

        device_arg = state.get("device")
        device = torch.device(device_arg) if device_arg else torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model.to(device); model.eval()

        with torch.no_grad():
            enc = tokenizer([query], padding=True, truncation=True, max_length=512, return_tensors="pt")
            enc = {k: v.to(device) for k, v in enc.items()}
            out = model(**enc)
            last_hidden = out.last_hidden_state
            mask = enc["attention_mask"].unsqueeze(-1).expand(last_hidden.size()).float()
            pooled = (last_hidden * mask).sum(dim=1) / torch.clamp(mask.sum(dim=1), min=1e-9)
            pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
            vec = pooled.cpu().numpy().astype(np.float32)[0].tolist()

        client = PersistentClient(path=state.get("chroma_path") or ".chroma")
        coll = client.get_collection(name=state.get("collection") or "default")
        n = int(state.get("top_k", 10))
        # Request supported fields; ids are returned by default
        res = coll.query(query_embeddings=[vec], n_results=n, include=["documents", "metadatas", "distances"])  # type: ignore
        ids = (res.get("ids") or [[]])[0]
        return {**state, "embed_results": res, "chroma_ids": ids, "chroma_available": True, "chroma_error": None}
    except Exception as e:
        # Make retrieval resilient if chroma fails
        return {**state, "embed_results": {"ids": [[]]}, "chroma_ids": [], "chroma_available": False, "chroma_error": str(e)}


def neo4j_query_by_entities_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Retrieve chunk IDs from Neo4j for the query entities with availability flags.
    Also returns which query keys actually exist in the KG for debugging (kg_matched_keys).
    """
    from neo4j import GraphDatabase

    # Normalize query entity texts too for robust matching
    raw_ents = state.get("query_entities", [])
    keys = []
    norm_aliases = []
    norm_keys = []
    phonetics = []
    for e in raw_ents:
        if not e.get("text"):
            continue
        label = e.get("label")
        text = e.get("text")
        keys.append(make_entity_key(label, text))
        nt = normalize_legal_entity(text)
        if nt:
            norm_aliases.append(nt)
            # label-aware normalized key for matching Entity.norm_key
            if label is not None:
                norm_keys.append(make_entity_key(label, nt))
            ph = phonetic_key(nt)
            if ph:
                phonetics.append(ph)
    if not keys:
        return {**state, "kg_ids": [], "kg_available": True, "kg_error": None, "kg_matched_keys": [], "kg_requested_keys": []}
    strict = bool(state.get("strict_match", True))
    uri = state.get("neo4j_uri", "bolt://localhost:7687")
    user = state.get("neo4j_user", "neo4j")
    password = state.get("neo4j_password")
    database = state.get("neo4j_database")
    limit = int(state.get("kg_limit", 25))
    if not password:
        # allow KG step to be skipped if not provided
        return {**state, "kg_ids": [], "kg_available": False, "kg_error": "neo4j_password not provided"}

    driver = GraphDatabase.driver(uri, auth=(user, password))
    try:
        def run_session(tx_func):
            if database:
                with driver.session(database=database) as session:
                    return session.execute_read(tx_func)
            else:
                with driver.session() as session:
                    return session.execute_read(tx_func)

        def query_tx_strict(tx):
            cypher = (
                "UNWIND $keys AS key "
                "MATCH (e:Entity {key: key})<-[:MENTIONS]-(c:Chunk) "
                "RETURN e.key AS ekey, c.id AS id, 'direct' AS reason, count(*) AS cnt "
                "UNION "
                "UNWIND $norm_keys AS nkey "
                "MATCH (e:Entity {norm_key: nkey})<-[:MENTIONS]-(c:Chunk) "
                "RETURN e.key AS ekey, c.id AS id, 'norm_key' AS reason, count(*) AS cnt "
                "UNION "
                "UNWIND $keys AS key "
                "WITH split(key,'|')[1] AS norm_text "
                "MATCH (al:Alias {name: norm_text})-[:ALIAS_OF]->(e:Entity) "
                "MATCH (c:Chunk)-[:MENTIONS]->(e) "
                "RETURN e.key AS ekey, c.id AS id, 'alias' AS reason, count(*) AS cnt "
                "UNION "
                "UNWIND $keys AS key "
                "WITH split(key,'|')[1] AS norm_text, $phonetics AS phs "
                "UNWIND phs AS ph "
                "MATCH (pl:PhoneticAlias {code: ph})-[:PHONETIC_OF]->(e:Entity) "
                "MATCH (c:Chunk)-[:MENTIONS]->(e) "
                "RETURN e.key AS ekey, c.id AS id, 'phonetic' AS reason, count(*) AS cnt"
            )
            result = tx.run(cypher, keys=keys, norm_keys=norm_keys, phonetics=phonetics, limit=limit)
            return [(r["ekey"], r["id"], r["reason"], r["cnt"]) for r in result]

        def query_tx_text_only(tx):
            # Match by normalized pieces or alias/phonetic (label-agnostic)
            cypher = (
                "UNWIND $norms AS norm_text "
                "MATCH (e:Entity) WHERE split(e.key,'|')[1] = norm_text OR split(e.norm_key,'|')[1] = norm_text "
                "MATCH (c:Chunk)-[:MENTIONS]->(e) "
                "RETURN e.key AS ekey, c.id AS id, 'text_norm' AS reason, count(*) AS cnt "
                "UNION "
                "UNWIND $norms AS norm_text "
                "MATCH (al:Alias {name: norm_text})-[:ALIAS_OF]->(e:Entity) "
                "MATCH (c:Chunk)-[:MENTIONS]->(e) "
                "RETURN e.key AS ekey, c.id AS id, 'alias' AS reason, count(*) AS cnt "
                "UNION "
                "UNWIND $phonetics AS ph "
                "MATCH (pl:PhoneticAlias {code: ph})-[:PHONETIC_OF]->(e:Entity) "
                "MATCH (c:Chunk)-[:MENTIONS]->(e) "
                "RETURN e.key AS ekey, c.id AS id, 'phonetic' AS reason, count(*) AS cnt"
            )
            result = tx.run(cypher, norms=norm_aliases, phonetics=phonetics, limit=limit)
            return [(r["ekey"], r["id"], r["reason"], r["cnt"]) for r in result]

        rows = run_session(query_tx_strict) or []
        if not rows and not strict:
            rows = run_session(query_tx_text_only) or []
        ids = []
        reasons_map: Dict[str, set] = {}
        matched_keys_set = set()
        ruler_query = bool(state.get("query_has_ruler", False))
        for key, cid, reason, cnt in rows:
            matched_keys_set.add(key)
            ids.append(cid)
            reasons_map.setdefault(cid, set()).add(reason)
        # Maintain order while deduping ids
        seen = set()
        ordered_ids = []
        for cid in ids:
            if cid not in seen:
                ordered_ids.append(cid)
                seen.add(cid)
        # Compute ruler-hit ids: only if alias/phonetic reason used AND query had ruler entities
        ruler_hit_ids = []
        if ruler_query:
            for cid in ordered_ids:
                reasons = reasons_map.get(cid, set())
                if any(r in ("alias", "phonetic") for r in reasons):
                    ruler_hit_ids.append(cid)
        return {**state, "kg_ids": ordered_ids, "kg_available": True, "kg_error": None, "kg_matched_keys": sorted(matched_keys_set), "kg_requested_keys": keys, "kg_match_reasons": {k: sorted(list(v)) for k, v in reasons_map.items()}, "kg_ruler_hit_ids": ruler_hit_ids}
    except Exception as e:
        return {**state, "kg_ids": [], "kg_available": False, "kg_error": str(e), "kg_matched_keys": [], "kg_requested_keys": keys}
    finally:
        try:
            driver.close()
        except Exception:
            pass


def merge_ids_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Merge ids from KG and embeddings with KG-priority reranking.

    Order:
    1) All ids that appear in KG results (kg_ids) in their given order.
    2) Remaining embedding-only ids in their embedding order.
    Truncate to top_k and compute provenance/source counts.
    """
    emb = state.get("embed_results") or {}
    emb_ids: list[str] = (emb.get("ids") or [[ ]])[0]
    kg_ids: list[str] = list(state.get("kg_ids", []))

    seen = set()
    ordered: list[str] = []
    # 1) KG-backed ids first (preserve kg order)
    for kid in kg_ids:
        if kid not in seen:
            ordered.append(kid); seen.add(kid)
    # 2) Then remaining embedding-only ids (preserve embedding order)
    for eid in emb_ids:
        if eid not in seen:
            ordered.append(eid); seen.add(eid)

    # Truncate to top_k
    top_k = int(state.get("top_k", 10))
    final_ids = ordered[:top_k]

    # provenance and source counts
    chroma_ids = list(state.get("chroma_ids") or emb_ids or [])
    prov: Dict[str, set] = {}
    prov_extra: Dict[str, list] = {}
    for cid in chroma_ids:
        prov.setdefault(cid, set()).add("chroma")
    for kid in kg_ids:
        prov.setdefault(kid, set()).add("kg")
    # Add extra provenance tag if KG match via alias/phonetic and query had ruler hits
    for cid in state.get("kg_ruler_hit_ids", []) or []:
        prov_extra.setdefault(cid, []).append("EntityRuler regex hit")
    both = [i for i in chroma_ids if i in set(kg_ids)]
    source_counts = {
        "chroma": len(chroma_ids),
        "kg": len(kg_ids),
        "both": len(both),
        "selected": len(final_ids),
        "chroma_available": bool(state.get("chroma_available", False)),
        "kg_available": bool(state.get("kg_available", False)),
    }
    return {**state, "final_ids": final_ids, "provenance": {k: sorted(list(v)) for k, v in prov.items()}, "provenance_extra": prov_extra, "source_counts": source_counts}


def fetch_docs_by_ids_node(state: Dict[str, Any]) -> Dict[str, Any]:
    """Fetch documents from Chroma by ids for the final selection."""
    from chromadb import PersistentClient
    ids = state.get("final_ids", [])
    if not ids:
        return {**state, "final_docs": [], "fetched_ids": [], "fetched_metas": []}
    client = PersistentClient(path=state.get("chroma_path") or ".chroma")
    coll = client.get_collection(name=state.get("collection") or "default")
    # Chroma does not support "ids" in include; ids are returned by default
    got = coll.get(ids=ids, include=["documents", "metadatas"])  # type: ignore
    # Map id -> document for ordering
    id_to_doc = {i: d for i, d in zip(got.get("ids", []), got.get("documents", []))}
    docs = [id_to_doc.get(i, "") for i in ids]
    return {**state, "final_docs": docs, "fetched_ids": got.get("ids", []), "fetched_metas": got.get("metadatas", [])}


def save_retrieved_text_node(state: Dict[str, Any]) -> Dict[str, Any]:
    output_path = state.get("output_path") or "retrieved.txt"
    ids = state.get("final_ids", [])
    docs = state.get("final_docs", [])
    prov = state.get("provenance", {})
    prov_extra = state.get("provenance_extra", {})
    counts = state.get("source_counts", {})
    chroma_avail = state.get("chroma_available")
    kg_avail = state.get("kg_available")
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        # Summary header line
        summary_line = (
            f"# sources: chroma={'yes' if chroma_avail else 'no'}, kg={'yes' if kg_avail else 'no'}; "
            f"counts: selected={counts.get('selected', len(ids))}, chroma={counts.get('chroma', 0)}, kg={counts.get('kg', 0)}, both={counts.get('both', 0)}"
        )
        f.write(summary_line + "\n\n")
        for i, (cid, text) in enumerate(zip(ids, docs)):
            tags = "+".join(prov.get(cid, [])) if cid in prov else ""
            header = f"### {cid}"
            if tags:
                header += f" [{tags}]"
            extras = prov_extra.get(cid)
            if extras:
                header += " " + " ".join(f"[{e}]" for e in extras)
            f.write(header + "\n")
            f.write((text or "").strip())
            f.write("\n\n")
    return {**state, "output_path": output_path}
