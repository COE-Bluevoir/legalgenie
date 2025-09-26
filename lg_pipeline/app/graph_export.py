from __future__ import annotations
import argparse
import json
import sys
from typing import Any, Iterable, Tuple


def _coerce_nodes_edges_from_graph_obj(graph_obj: Any) -> Tuple[list[str], list[tuple[str, str]]]:
    """Best-effort extraction of nodes/edges from various graph objects produced by LangGraph.

    Tries (in order): compiled graph .get_graph(), networkx-like (nodes/edges), pydot-like,
    underlying .graph attribute, and raises if none succeed.
    """
    # 1) If compiled object exposes get_graph(), recurse
    if hasattr(graph_obj, "get_graph"):
        try:
            inner = graph_obj.get_graph()
            return _coerce_nodes_edges_from_graph_obj(inner)
        except Exception:
            pass

    # 2) networkx-like API
    nodes_attr = getattr(graph_obj, "nodes", None)
    edges_attr = getattr(graph_obj, "edges", None)
    if nodes_attr is not None and edges_attr is not None:
        try:
            nodes_raw = nodes_attr() if callable(nodes_attr) else list(nodes_attr)
            edges_raw = edges_attr() if callable(edges_attr) else list(edges_attr)
            nodes = [str(n) for n in nodes_raw]
            edges: list[tuple[str, str]] = []
            for e in edges_raw:
                if len(e) >= 2:
                    u, v = e[0], e[1]
                    edges.append((str(u), str(v)))
            return nodes, edges
        except Exception:
            pass

    # 3) pydot-like API
    if getattr(graph_obj, "get_nodes", None) and getattr(graph_obj, "get_edges", None):
        try:
            nodes = [str(n.get_name()) for n in graph_obj.get_nodes()]
            edges = [(str(e.get_source()), str(e.get_destination())) for e in graph_obj.get_edges()]
            return nodes, edges
        except Exception:
            pass

    # 4) Fallback to .graph attribute
    inner = getattr(graph_obj, "graph", None)
    if inner is not None and inner is not graph_obj:
        return _coerce_nodes_edges_from_graph_obj(inner)

    raise RuntimeError("Unable to extract nodes/edges from the provided graph object")


def _to_mermaid(nodes: Iterable[str], edges: Iterable[tuple[str, str]]) -> str:
    def norm(n: str) -> str:
        return (
            n.replace(" ", "_")
             .replace("-", "_")
             .replace(".", "_")
             .replace(":", "_")
             .replace("[", "")
             .replace("]", "")
             .replace("'", "")
        )

    lines = ["flowchart TD"]
    declared = set()
    for n in nodes:
        nn = norm(n)
        if nn not in declared:
            lines.append(f"  {nn}[{n}]")
            declared.add(nn)
    for u, v in edges:
        lines.append(f"  {norm(u)} --> {norm(v)}")
    return "\n".join(lines)


def _to_dot(nodes: Iterable[str], edges: Iterable[tuple[str, str]]) -> str:
    def q(n: str) -> str:
        return '"' + n.replace('"', '\\"') + '"'
    lines = ["digraph G {"]
    for n in nodes:
        lines.append(f"  {q(n)};")
    for u, v in edges:
        lines.append(f"  {q(u)} -> {q(v)};")
    lines.append("}")
    return "\n".join(lines)


def _build_graph_object(which: str) -> Any:
    from . import graph as g

    name = (which or "retrieve").strip().lower()
    candidates = [
        f"build_{name}_graph",
        f"build_{name}",
        "build_retrieve_graph",
        "build_graph",
    ]
    builder = None
    for cand in candidates:
        fn = getattr(g, cand, None)
        if callable(fn):
            builder = fn
            break
    if not callable(builder):
        raise RuntimeError(f"No graph builder found for '{which}'. Tried: {candidates}")
    obj = builder()
    # If it's a StateGraph, it may already be compiled; compile() if available
    compile_fn = getattr(obj, "compile", None)
    if callable(compile_fn):
        try:
            obj = compile_fn()
        except TypeError:
            obj = compile_fn()
    return obj


def _manual_fallback(which: str) -> tuple[list[str], list[tuple[str, str]]]:
    """Return hard-coded node/edge lists for each known graph as a fallback.

    This guarantees output even if internal LangGraph compiled structure changes.
    """
    w = which.lower()
    if w in ("docx", "build_graph"):
        nodes = ["START", "load", "split", "save", "END"]
        edges = [("START", "load"), ("load", "split"), ("split", "save"), ("save", "END")]
        return nodes, edges
    if w in ("json",):
        nodes = ["START", "load", "split", "save", "END"]
        edges = [("START", "load"), ("load", "split"), ("split", "save"), ("save", "END")]
        return nodes, edges
    if w == "embed":
        nodes = ["START", "load", "embed", "save", "END"]
        edges = [("START", "load"), ("load", "embed"), ("embed", "save"), ("save", "END")]
        return nodes, edges
    if w == "chroma":
        nodes = ["START", "load", "upsert", "END"]
        edges = [("START", "load"), ("load", "upsert"), ("upsert", "END")]
        return nodes, edges
    if w == "ner":
        nodes = ["START", "load", "ner", "END"]
        edges = [("START", "load"), ("load", "ner"), ("ner", "END")]
        return nodes, edges
    if w == "neo4j":
        nodes = ["START", "load", "ingest", "END"]
        edges = [("START", "load"), ("load", "ingest"), ("ingest", "END")]
        return nodes, edges
    if w == "retrieve":
        nodes = ["START", "prepare", "ner_query", "embed_query", "kg_query", "merge", "fetch", "save", "END"]
        edges = [
            ("START", "prepare"),
            ("prepare", "ner_query"),
            ("ner_query", "embed_query"),
            ("embed_query", "kg_query"),
            ("kg_query", "merge"),
            ("merge", "fetch"),
            ("fetch", "save"),
            ("save", "END"),
        ]
        return nodes, edges
    raise RuntimeError(f"No fallback mapping for graph '{which}'")


def main():
    ap = argparse.ArgumentParser(description="Export LangGraph structure (nodes/edges) as Mermaid / DOT / JSON")
    ap.add_argument("--graph", default="retrieve", help="Graph to export: retrieve|docx|json|embed|chroma|ner|neo4j")
    ap.add_argument("--format", default="mermaid", choices=["mermaid", "dot", "json"], help="Output format")
    ap.add_argument("--output", default="-", help="Output file path or - for stdout")
    args = ap.parse_args()

    try:
        graph_obj = _build_graph_object(args.graph)
        try:
            nodes, edges = _coerce_nodes_edges_from_graph_obj(graph_obj)
        except Exception:
            # fallback to manual mapping
            nodes, edges = _manual_fallback(args.graph)
    except Exception as e:
        try:
            nodes, edges = _manual_fallback(args.graph)
        except Exception:
            print(f"[graph_export] Failed for graph '{args.graph}': {e}", file=sys.stderr)
            sys.exit(2)

    if args.format == "mermaid":
        content = _to_mermaid(nodes, edges)
    elif args.format == "dot":
        content = _to_dot(nodes, edges)
    else:
        content = json.dumps({"nodes": nodes, "edges": edges}, indent=2)

    if args.output == "-" or args.output.lower() == "stdout":
        print(content)
    else:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(content)


if __name__ == "__main__":
    main()
