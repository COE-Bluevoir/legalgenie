from __future__ import annotations
import argparse
import json
import os
from typing import List, Dict, Any
import logging


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Run NER over JSONL chunks using a local HF model (executed inside ner_env)")
    p.add_argument("--input", required=True, help="Path to input chunks JSONL: {text, metadata}")
    p.add_argument("--output", required=True, help="Path to output NER JSONL: {text, metadata, entities[]}")
    # Framework selection
    p.add_argument("--framework", default="spacy", choices=["spacy", "transformers"], help="NER framework to use")
    # spaCy options
    p.add_argument("--spacy-model", default="en_legal_ner_trf", help="spaCy package/model name installed in env (e.g., en_legal_ner_trf)")
    # Transformers options
    p.add_argument("--model-path", default=None, help="Local HF model directory (contains config.json) for transformers framework")
    p.add_argument("--batch-size", type=int, default=16, help="Batch size for pipeline")
    p.add_argument("--device", default="cpu", help="torch device: cpu|cuda|cuda:0 ... (transformers only)")
    p.add_argument("--aggregation", default="simple", choices=["simple", "none"], help="Aggregation strategy for token-classification (transformers)")
    # Optional embedding model for fallback similarity (spaCy mode only)
    p.add_argument("--embed-model-path", default=None, help="Local HF embedding model directory for fallback statute matching (optional)")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    if not os.path.exists(args.input):
        raise FileNotFoundError(f"Input not found: {args.input}")
    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)

    # Load records
    records: List[Dict[str, Any]] = []
    with open(args.input, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))

    if args.framework == "spacy":
        import spacy
        from spacy.pipeline import EntityRuler
        from spacy.matcher import PhraseMatcher
        from spacy.tokens import Span
        from app.legal_normalizer import normalize_unicode, normalize_sections, normalize_legal_entity
        from app.legal_patterns import patterns as LEGAL_PATTERNS

        # Load spaCy model
        nlp = spacy.load(args.spacy_model)

    # Configure logging for debug visibility
        logging.basicConfig(level=logging.DEBUG)
        log = logging.getLogger("nlp")

        # ---------------- EntityRuler augmentation ----------------
        # Insert EntityRuler with explicit legal patterns BEFORE NER
        try:
            ruler: EntityRuler = nlp.add_pipe("entity_ruler", before="ner")  # type: ignore
        except Exception:
            ruler = nlp.add_pipe("entity_ruler")  # type: ignore
        ruler.add_patterns(LEGAL_PATTERNS)

        # Span extension for provenance
        if not Span.has_extension("source"):
            Span.set_extension("source", default=None)

        # Logger component to mark and log EntityRuler hits
        from spacy.language import Language

        @Language.component("ruler_logger")
        def ruler_logger_component(doc):
            hit_cnt = 0
            for ent in doc.ents:
                if ent.ent_id_ and ent.ent_id_.startswith((
                    "CASE_CITATION:", "STATUTE_SECTION:", "STATUTE:", "COURT:", "CASE_NUMBER:", "DATE:", "PARTY:", "JUDGE:", "GPE:"
                )):
                    ent._.set("source", "ruler")
                    log.info(f"[EntityRuler regex hit] {ent.label_}: '{ent.text}' (span {ent.start_char}-{ent.end_char}) id={ent.ent_id_}")
                    hit_cnt += 1
            if hit_cnt:
                doc._.ruler_hits = hit_cnt if hasattr(doc._, "ruler_hits") else hit_cnt
            return doc

        # Register a doc extension for counting ruler hits (idempotent)
        from spacy.tokens import Doc
        if not Doc.has_extension("ruler_hits"):
            Doc.set_extension("ruler_hits", default=0)

        if "ruler_logger" not in nlp.pipe_names:
            nlp.add_pipe("ruler_logger", after="entity_ruler")

        # ---------------- Gazetteer / dictionary layer ----------------
        # Abbrev -> full name + label
        GAZETTEER: Dict[str, Dict[str, str]] = {
            "ipc": {"name": "Indian Penal Code, 1860", "label": "STATUTE"},
            "crpc": {"name": "Code of Criminal Procedure, 1973", "label": "STATUTE"},
            "cpc": {"name": "Code of Civil Procedure, 1908", "label": "STATUTE"},
            "sc": {"name": "Supreme Court of India", "label": "COURT"},
            "hc": {"name": "High Court", "label": "COURT"},
        }
        phrase_matcher = PhraseMatcher(nlp.vocab, attr="LOWER")
        for abbr in ["ipc", "crpc", "cpc", "sc", "hc"]:
            phrase_matcher.add(f"GAZ_{abbr.upper()}", [nlp.make_doc(abbr)])

        # ---------------- Optional embedding fallback ----------------
        embed_model = None
        embed_tokenizer = None
        statute_names = [
            "Indian Penal Code, 1860",
            "Code of Criminal Procedure, 1973",
            "Code of Civil Procedure, 1908",
            "Indian Evidence Act, 1872",
            "Information Technology Act, 2000",
            "Constitution of India",
        ]
        statute_labels = {name: "STATUTE" for name in statute_names}
        statute_vecs = None
        if args.embed_model_path:
            try:
                import torch
                from transformers import AutoTokenizer, AutoModel
                embed_tokenizer = AutoTokenizer.from_pretrained(args.embed_model_path, local_files_only=True)
                embed_model = AutoModel.from_pretrained(args.embed_model_path, local_files_only=True)
                device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
                embed_model.to(device); embed_model.eval()

                def encode(texts: List[str]):
                    with torch.no_grad():
                        enc = embed_tokenizer(texts, padding=True, truncation=True, max_length=256, return_tensors="pt")
                        enc = {k: v.to(device) for k, v in enc.items()}
                        out = embed_model(**enc)
                        last = out.last_hidden_state
                        mask = enc["attention_mask"].unsqueeze(-1).expand(last.size()).float()
                        pooled = (last * mask).sum(dim=1) / torch.clamp(mask.sum(dim=1), min=1e-9)
                        pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
                        return pooled.cpu()
                statute_vecs = encode(statute_names)
            except Exception as e:
                log.debug(f"[fallback] embedding model unavailable: {e}")
                embed_model = None
                embed_tokenizer = None
                statute_vecs = None

        # Helper: overlap check
        def overlaps(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
            return not (a_end <= b_start or b_end <= a_start)

        # Process records and write enriched entities
        with open(args.output, "w", encoding="utf-8") as out_f:
            for rec in records:
                original_text = rec.get("text", "") or ""
                metadata = rec.get("metadata", {}) or {}
                # Preprocess only for optional embedding similarity
                cleaned_text = normalize_sections(normalize_unicode(original_text))

                # Run full pipeline (EntityRuler + NER) on original text to preserve offsets
                doc_full = nlp(original_text)
                ents_out: List[Dict[str, Any]] = []
                taken: List[tuple] = []
                for ent in doc_full.ents:
                    span_txt = ent.text
                    if not span_txt.strip():
                        continue
                    # Offsets are from original text already
                    st, en = ent.start_char, ent.end_char
                    if any(overlaps(st, en, s, e) for s, e in taken):
                        continue
                    source_val = ent._.source if hasattr(ent._, "source") else None
                    ents_out.append({
                        "text": original_text[st:en],
                        "label": ent.label_,
                        "start": st,
                        "end": en,
                        "score": None,
                        "normalized": normalize_legal_entity(span_txt),
                        "source": (source_val or "ner"),
                    })
                    taken.append((st, en))
                    if (source_val or "") == "ruler":
                        log.info(f"[EntityRuler hit] {ent.label_}: {span_txt}")

                # Dictionary/gazetteer layer on original doc
                doc_orig = nlp.make_doc(original_text)
                matches = phrase_matcher(doc_orig)
                for mid, start, end in matches:
                    span = doc_orig[start:end]
                    key = span.text.lower()
                    info = GAZETTEER.get(key)
                    if not info:
                        continue
                    st, en = span.start_char, span.end_char
                    if any(overlaps(st, en, s, e) for s, e in taken):
                        continue
                    ents_out.append({
                        "text": info["name"],  # replace with canonical full name
                        "label": info["label"],
                        "start": st,
                        "end": en,
                        "score": 1.0,
                        "normalized": normalize_legal_entity(info["name"]),
                        "source": "dictionary",
                    })
                    taken.append((st, en))
                    log.info(f"[Dictionary hit] {info['label']}: {info['name']}")

                # Optional fallback similarity using embeddings
                if embed_model is not None and statute_vecs is not None and len(ents_out) > 0:
                    try:
                        # Only consider adding a STATUTE if none exists yet
                        if not any(e.get("label") == "STATUTE" for e in ents_out):
                            q_vec = encode([cleaned_text])  # type: ignore[name-defined]
                            import torch
                            sims = torch.nn.functional.cosine_similarity(q_vec, statute_vecs)[0]
                            best_idx = int(torch.argmax(sims).item())
                            best_sim = float(sims[best_idx].item())
                            if best_sim >= 0.8:
                                name = statute_names[best_idx]
                                ents_out.append({
                                    "text": name,
                                    "label": statute_labels[name],
                                    "start": 0,
                                    "end": 0,
                                    "score": best_sim,
                                    "normalized": normalize_legal_entity(name),
                                    "source": "fallback_similarity",
                                })
                                log.info(f"[Fallback similarity hit] {name} (sim={best_sim:.2f})")
                    except Exception as e:
                        log.debug(f"[fallback] similarity error: {e}")

                obj = {
                    "text": original_text,
                    "metadata": metadata,
                    "entities": ents_out,
                }
                json.dump(obj, out_f, ensure_ascii=False)
                out_f.write("\n")
                try:
                    if hasattr(doc_full._, "ruler_hits") and doc_full._.ruler_hits:
                        log.debug(f"[EntityRuler] hits in doc: {doc_full._.ruler_hits}")
                except Exception:
                    pass
        return

    # transformers framework
    from transformers import AutoTokenizer, AutoModelForTokenClassification, pipeline
    # Resolve device for transformers
    if args.device and args.device.startswith("cuda"):
        device = 0 if ":" not in args.device else int(args.device.split(":", 1)[1])
    else:
        device = -1
    if not args.model_path:
        raise ValueError("--model-path is required when --framework=transformers")
    tok = AutoTokenizer.from_pretrained(args.model_path, local_files_only=True)
    mdl = AutoModelForTokenClassification.from_pretrained(args.model_path, local_files_only=True)
    nlp = pipeline("token-classification", model=mdl, tokenizer=tok, aggregation_strategy=(None if args.aggregation == "none" else args.aggregation), device=device)

    with open(args.output, "w", encoding="utf-8") as out_f:
        for i in range(0, len(records), args.batch_size):
            batch = records[i:i+args.batch_size]
            texts = [r.get("text", "") for r in batch]
            results = nlp(texts, batch_size=args.batch_size, truncation=True)
            if isinstance(results, dict) or (results and isinstance(results[0], dict)):
                results = [results] if isinstance(results, dict) else [results]
            for rec, ents in zip(batch, results):
                norm_ents = []
                for e in ents or []:
                    norm_ents.append({
                        "text": e.get("word") or e.get("text"),
                        "label": e.get("entity_group") or e.get("entity"),
                        "start": e.get("start"),
                        "end": e.get("end"),
                        "score": float(e.get("score", 0.0)) if e.get("score") is not None else None,
                        "source": "ner",
                    })
                obj = {
                    "text": rec.get("text"),
                    "metadata": rec.get("metadata", {}),
                    "entities": norm_ents,
                }
                json.dump(obj, out_f, ensure_ascii=False)
                out_f.write("\n")


if __name__ == "__main__":
    main()
