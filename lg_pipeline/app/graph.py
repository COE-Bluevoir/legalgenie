from __future__ import annotations
from typing import Dict, Any

from langgraph.graph import StateGraph, START, END

from .nodes import (
    load_node, split_node, save_node,
    load_json_node, split_json_node, save_json_simple_node,
    load_jsonl_chunks_node, embed_node, save_embeddings_node,
    load_embeddings_jsonl_node, chroma_upsert_node,
    load_jsonl_for_ner_node, run_ner_external_node,
    load_ner_jsonl_node, neo4j_ingest_node,
    prepare_query_node, ner_query_external_node, chroma_query_by_embedding_node, neo4j_query_by_entities_node, merge_ids_node, fetch_docs_by_ids_node, save_retrieved_text_node,
)


# Define the state as a simple dict
# Keys used: input_path, output_path, config, raw_text, metadata, chunks

def build_graph():
    g = StateGraph(dict)

    g.add_node("load", load_node)
    g.add_node("split", split_node)
    g.add_node("save", save_node)

    g.add_edge(START, "load")
    g.add_edge("load", "split")
    g.add_edge("split", "save")
    g.add_edge("save", END)

    return g.compile()


def build_retrieve_graph():
    g = StateGraph(dict)

    g.add_node("prepare", prepare_query_node)
    g.add_node("ner_query", ner_query_external_node)
    g.add_node("embed_query", chroma_query_by_embedding_node)
    g.add_node("kg_query", neo4j_query_by_entities_node)
    g.add_node("merge", merge_ids_node)
    g.add_node("fetch", fetch_docs_by_ids_node)
    g.add_node("save", save_retrieved_text_node)

    g.add_edge(START, "prepare")
    g.add_edge("prepare", "ner_query")
    # Serialize branches to avoid concurrent root updates
    g.add_edge("ner_query", "embed_query")
    g.add_edge("embed_query", "kg_query")
    g.add_edge("kg_query", "merge")
    g.add_edge("merge", "fetch")
    g.add_edge("fetch", "save")
    g.add_edge("save", END)

    return g.compile()


def build_json_graph():
    g = StateGraph(dict)

    g.add_node("load", load_json_node)
    g.add_node("split", split_json_node)
    g.add_node("save", save_json_simple_node)

    g.add_edge(START, "load")
    g.add_edge("load", "split")
    g.add_edge("split", "save")
    g.add_edge("save", END)

    return g.compile()


def build_embed_graph():
    g = StateGraph(dict)

    g.add_node("load", load_jsonl_chunks_node)
    g.add_node("embed", embed_node)
    g.add_node("save", save_embeddings_node)

    g.add_edge(START, "load")
    g.add_edge("load", "embed")
    g.add_edge("embed", "save")
    g.add_edge("save", END)

    return g.compile()


def build_chroma_graph():
    g = StateGraph(dict)

    g.add_node("load", load_embeddings_jsonl_node)
    g.add_node("upsert", chroma_upsert_node)

    g.add_edge(START, "load")
    g.add_edge("load", "upsert")
    g.add_edge("upsert", END)

    return g.compile()


def build_ner_graph():
    g = StateGraph(dict)

    g.add_node("load", load_jsonl_for_ner_node)
    g.add_node("ner", run_ner_external_node)

    g.add_edge(START, "load")
    g.add_edge("load", "ner")
    g.add_edge("ner", END)

    return g.compile()


def build_neo4j_graph():
    g = StateGraph(dict)

    g.add_node("load", load_ner_jsonl_node)
    g.add_node("ingest", neo4j_ingest_node)

    g.add_edge(START, "load")
    g.add_edge("load", "ingest")
    g.add_edge("ingest", END)

    return g.compile()
