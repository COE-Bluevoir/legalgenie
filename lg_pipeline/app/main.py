from __future__ import annotations
import argparse
import json
from typing import Any, Dict

from .graph import build_graph, build_json_graph, build_embed_graph, build_chroma_graph, build_ner_graph, build_neo4j_graph, build_retrieve_graph


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="DOCX/JSON -> chunks.jsonl via LangGraph + LangChain")
    p.add_argument("--input", required=False, default=None, help="Path to input file (required for docx/json/embed/chroma/ner/neo4j modes)")
    p.add_argument("--output", required=False, default=None, help="Path to output JSONL (optional)")
    p.add_argument("--mode", choices=["docx", "json", "embed", "chroma", "ner", "neo4j", "retrieve"], default="docx", help="Processing mode")
    # Chroma options
    p.add_argument("--chroma-path", default=None, help="ChromaDB persistent path (defaults to .chroma)")
    p.add_argument("--collection", default="default", help="ChromaDB collection name")
    p.add_argument("--chunk-size", type=int, default=1200)
    p.add_argument("--chunk-overlap", type=int, default=200)
    p.add_argument("--model-path", default=None, help="Local HF model directory for embeddings (embed mode)")
    p.add_argument("--batch-size", type=int, default=32, help="Batch size for embeddings (embed mode)")
    p.add_argument("--device", default=None, help="torch device, e.g. cuda or cpu (embed mode)")
    # Retrieve options
    p.add_argument("--query", default=None, help="User query to retrieve relevant chunks")
    p.add_argument("--top-k", type=int, default=10, help="Top K chunks to return")
    p.add_argument("--kg-limit", type=int, default=25, help="Max KG hits to consider")
    # Allow --strict-match / --no-strict-match
    p.add_argument("--strict-match", action=argparse.BooleanOptionalAction, default=True, help="Use strict exact key match in KG (default true)")
    # Neo4j options
    p.add_argument("--neo4j-uri", default="bolt://localhost:7687")
    p.add_argument("--neo4j-user", default="neo4j")
    p.add_argument("--neo4j-password", default=None)
    p.add_argument("--neo4j-database", default=None, help="Optional database name")
    # NER options
    p.add_argument("--ner-model-path", default=None, help="Local HF NER model directory (contains config.json)")
    p.add_argument("--ner-env", default="ner_env", help="Conda environment name that has the NER model deps")
    p.add_argument("--aggregation", default="simple", choices=["simple", "none"], help="NER aggregation strategy")
    p.add_argument("--framework", default="spacy", choices=["spacy", "transformers"], help="NER framework to use")
    p.add_argument("--spacy-model", default="en_legal_ner_trf", help="spaCy model name installed in ner_env")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    if args.mode == "docx":
        app = build_graph()
    elif args.mode == "json":
        app = build_json_graph()
    elif args.mode == "embed":
        app = build_embed_graph()
    elif args.mode == "chroma":
        app = build_chroma_graph()
    elif args.mode == "neo4j":
        app = build_neo4j_graph()
    elif args.mode == "retrieve":
        app = build_retrieve_graph()
    else:
        app = build_ner_graph()

    state: Dict[str, Any] = {"output_path": args.output}
    # Only modes that operate on a file need input_path
    if args.mode in ("docx", "json", "embed", "chroma", "ner", "neo4j"):
        if not args.input:
            raise SystemExit("--input is required for this mode")
        state["input_path"] = args.input
    if args.mode in ("docx", "json"):
        state["config"] = {
            "chunk_size": args.chunk_size,
            "chunk_overlap": args.chunk_overlap,
            "separators": None,
        }
    if args.mode == "embed":
        state.update({
            "model_path": args.model_path,
            "batch_size": args.batch_size,
            "device": args.device,
        })
    if args.mode == "chroma":
        state.update({
            "chroma_path": args.chroma_path,
            "collection": args.collection,
            "batch_size": args.batch_size,
        })
    if args.mode == "neo4j":
        state.update({
            "neo4j_uri": args.neo4j_uri,
            "neo4j_user": args.neo4j_user,
            "neo4j_password": args.neo4j_password,
            "neo4j_database": args.neo4j_database,
            "batch_size": args.batch_size,
        })
    if args.mode == "retrieve":
        state.update({
            "query": args.query,
            "output_path": args.output,
            # NER for query
            "framework": args.framework,
            "spacy_model": args.spacy_model,
            "ner_env": args.ner_env,
            # Embedding/chroma
            "model_path": args.model_path,
            "device": args.device,
            "top_k": args.top_k,
            "chroma_path": args.chroma_path,
            "collection": args.collection,
            # KG
            "kg_limit": args.kg_limit,
            "neo4j_uri": args.neo4j_uri,
            "neo4j_user": args.neo4j_user,
            "neo4j_password": args.neo4j_password,
            "neo4j_database": args.neo4j_database,
            "strict_match": args.strict_match,
        })
    if args.mode == "ner":
        state.update({
            "framework": args.framework,
            "spacy_model": args.spacy_model,
            "ner_model_path": args.ner_model_path,
            "ner_env": args.ner_env,
            "batch_size": args.batch_size,
            "device": args.device,
            "aggregation": args.aggregation,
        })

    result = app.invoke(state)

    # Print a concise JSON summary depending on mode
    summary: Dict[str, Any] = {}
    if result.get("output_path"):
        summary["output_path"] = result.get("output_path")
    if args.mode == "chroma":
        # Include upsert stats for Chroma operations
        if "upserted" in result:
            summary["upserted"] = result["upserted"]
        if "chroma_path" in result:
            summary["chroma_path"] = result["chroma_path"]
        if "collection" in result:
            summary["collection"] = result["collection"]
    if args.mode == "ner":
        # Include NER output path explicitly
        if result.get("output_path"):
            summary["output_path"] = result["output_path"]
        if result.get("ner_env"):
            summary["ner_env"] = result["ner_env"]
    if args.mode == "neo4j":
        if "ingested" in result:
            summary["ingested"] = result["ingested"]
        if "neo4j_uri" in result:
            summary["neo4j_uri"] = result["neo4j_uri"]
        if "neo4j_user" in result:
            summary["neo4j_user"] = result["neo4j_user"]
    if args.mode == "retrieve":
        if result.get("output_path"):
            summary["output_path"] = result["output_path"]
        # Include which sources were available/used
        for k in ("chroma_available", "kg_available", "chroma_error", "kg_error"):
            if k in result:
                summary[k] = result[k]
        # Include KG key diagnostics if available
        if "kg_requested_keys" in result:
            summary["kg_requested_keys"] = result["kg_requested_keys"]
        if "kg_matched_keys" in result:
            summary["kg_matched_keys"] = result["kg_matched_keys"]
        if "source_counts" in result:
            summary["source_counts"] = result["source_counts"]
        if "final_ids" in result:
            summary["final_ids"] = result["final_ids"]
        if "provenance" in result:
            # Only keep provenance for selected ids to keep output small
            sel = result.get("final_ids") or []
            prov = result.get("provenance") or {}
            summary["provenance"] = {i: prov.get(i, []) for i in sel}

    print(json.dumps(summary or {"status": "ok"}, indent=2))


if __name__ == "__main__":
    main()
