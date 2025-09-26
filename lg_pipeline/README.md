## LangGraph Legal Pipeline (DOCX → Chunks → Embeddings → Chroma → NER → Neo4j → Retrieval)

This project gives you an end‑to‑end, local workflow to process a legal judgment (.docx), split it into chunks, embed those chunks with a local Hugging Face model, index them in ChromaDB, extract entities with a spaCy NER pipeline (in a separate Conda env), ingest entities into Neo4j, and finally run hybrid retrieval (Knowledge Graph + Embeddings) for a user query. All commands below are copy‑paste‑ready for Windows PowerShell.

What you get:
- Simple CLI: one Python module with multiple modes (docx/json/embed/chroma/ner/neo4j/retrieve)
- Persistent vector store using ChromaDB (.\.chroma folder)
- Neo4j graph with Document/Chunk/Entity nodes, aliases (including phonetic), and MENTIONS edges
- Hybrid retrieval that merges KG and embedding results with provenance

## Prerequisites (Windows)

- Python 3.10+ installed (check with: `python --version`)
- PowerShell (default on Windows)
- Conda (Miniconda/Anaconda) for the separate NER environment (required for the NER step)
- Neo4j running locally (Desktop or Server) on `bolt://localhost:7687` with username `neo4j` and your password--> ** Local Instance not remote connection
- A local Hugging Face embedding model directory that contains a `config.json` file

If you don’t have Conda yet, install Miniconda and ensure the `conda` command is available in PowerShell. For Neo4j, install Neo4j Desktop or Server, create a database, and note the password you set (we’ll pass it on the CLI).

## 1) Clone and install Python dependencies

Open PowerShell in the project folder and install deps:

```powershell
python -m pip install -r requirements.txt
```

Run tests (optional, quick sanity):

```powershell
pytest -q
```
got some failures

## 2) Prepare the NER environment (ner_env)

Create a separate Conda env that has spaCy and your NER model. The default spaCy model name used here is `en_legal_ner_trf`. If you don’t have that model, you can start with `en_core_web_sm` and switch the flag `--spacy-model en_core_web_sm` to verify the pipeline end‑to‑end.

Example (you can adapt to your model):

```powershell
conda create -n ner_env python=3.10 -y
conda run -n ner_env python -m pip install spacy==3.7.4
# If you have a custom legal model, install it here. Otherwise as a fallback:
conda run -n ner_env python -m spacy download en_core_web_sm
```

## 3) Prepare a local embedding model directory

Embedding steps require a local HF model directory that contains `config.json` (and tokenizer files). Point `--model-path` to that folder. A typical cache path looks like:

```
C:\Users\<you>\OneDrive - <org>\Desktop\embeddings\hf_cache_inlegalbert\snapshots\<revision>
```

If you point to a parent folder, the app will search for a subfolder that actually contains `config.json`. If you see “Could not find config.json under the provided path”, point the flag to the deepest folder that directly contains `config.json`.

## 4) End‑to‑end: run the pipeline step by step

You can run only the steps you need. Below is a full, typical flow using the sample `Judgement_of_Kaladevi_3_Extracted` files.

### A. DOCX → chunks.jsonl

```powershell
python -m app.main --mode docx --input .\Judgement_of_Kaladevi_3_Extracted.docx --output .\Judgement_of_Kaladevi_3_Extracted.chunks.jsonl --chunk-size 1200 --chunk-overlap 200
```

Notes:
- Output is one JSON object per line: `{ text, metadata }`.
- If `--output` is omitted, the file is created next to the input as `<name>.chunks.jsonl`.

### B. JSON → chunks.jsonl (optional alternate input)- *failed

If you have JSON with a top‑level `results` array of `{ id, doc }`:

```powershell
python -m app.main --mode json --input .\raw_cases.json --output .\raw_cases.chunks.jsonl --chunk-size 1200 --chunk-overlap 200
```

### C. chunks.jsonl → embeddings.jsonl

Generate embeddings using your local HF model:

```powershell
python -m app.main --mode embed --input .\Judgement_of_Kaladevi_3_Extracted.chunks.jsonl --output .\Judgement_of_Kaladevi_3_Extracted.embeddings.jsonl --model-path "C:\\Users\\ShreyasSuvarna\\OneDrive - Bluevoir\\Desktop\\embeddings\\hf_cache_inlegalbert" --batch-size 32 --device cpu
```

Details:
- Uses mean pooling over the last hidden state and L2‑normalizes vectors.
- `--device` can be `cpu` or `cuda` if you have a CUDA‑enabled GPU and a compatible PyTorch install.

### D. embeddings.jsonl → ChromaDB

Upsert embeddings into a local persistent Chroma collection (creates `.\\.chroma`):

```powershell
python -m app.main --mode chroma --input .\Judgement_of_Kaladevi_3_Extracted.embeddings.jsonl --chroma-path .\.chroma --collection kaladevi --batch-size 128
```

The CLI prints a JSON summary like `{ "upserted": N, "chroma_path": ".\\.chroma", "collection": "kaladevi" }`.

### E. chunks.jsonl → NER JSONL (runs inside ner_env)

This runs your NER in the separate Conda env and writes entities per chunk:

```powershell
python -m app.main --mode ner --input .\Judgement_of_Kaladevi_3_Extracted.chunks.jsonl --output .\Judgement_of_Kaladevi_3_Extracted.ner.jsonl --framework spacy --spacy-model en_legal_ner_trf --ner-env ner_env --batch-size 16
```

Output: one JSON object per line `{ text, metadata, entities: [ { text, label, start, end, score, source } ] }`.

Tip: If you don’t have the `en_legal_ner_trf` model, try `--spacy-model en_core_web_sm` to validate the flow.

### F. NER JSONL → Neo4j (ingest entities/aliases)

Make sure your Neo4j DB is running and you know the password. Then ingest:

```powershell
python -m app.main --mode neo4j --input .\Judgement_of_Kaladevi_3_Extracted.ner.jsonl --neo4j-uri "bolt://localhost:7687" --neo4j-user "neo4j" --neo4j-password "12345678" --batch-size 1000
```

What gets stored:
- Nodes: `Document(id)`, `Chunk(id=doc_id:chunk_id)`, `Entity(key,label,text,norm_text,norm_key)`, plus `Alias(name)` and `PhoneticAlias(code)`
- Relationships: `(:Document)-[:HAS_CHUNK]->(:Chunk)`, `(:Chunk)-[:MENTIONS {start,end,score,source}]->(:Entity)`, `(:Alias)-[:ALIAS_OF]->(:Entity)`, `(:PhoneticAlias)-[:PHONETIC_OF]->(:Entity)`

### G. Retrieval (NER on query + Chroma + Neo4j → retrieved.txt)

Run hybrid retrieval for a question and write a readable `retrieved.txt` with provenance tags:

```powershell
python -m app.main --mode retrieve --query "What did the Supreme Court decide about Section 49 of the Registration Act?" --output .\retrieved.txt --framework spacy --spacy-model en_legal_ner_trf --ner-env ner_env --model-path "C:\\Users\\ShreyasSuvarna\\OneDrive - Bluevoir\\Desktop\\embeddings\\hf_cache_inlegalbert" --device cpu --top-k 8 --chroma-path .\.chroma --collection kaladevi --neo4j-uri "bolt://localhost:7687" --neo4j-user "neo4j" --neo4j-password "12345678" --kg-limit 25
```

Notes:
- By default, the KG step uses strict label‑aware keys. To loosen matching, add `--no-strict-match`.
- The CLI also prints a small JSON summary (availability, source counts, matched keys, selected ids).
- `retrieved.txt` shows each selected chunk with `[chroma]`, `[kg]`, or both, and extra tags when regex‑based rules helped the match.

## Handy tips and checks

Quick inspect JSONL files in PowerShell:

```powershell
# First 3 lines
Get-Content .\Judgement_of_Kaladevi_3_Extracted.chunks.jsonl -TotalCount 3

# Count lines
(Get-Content .\Judgement_of_Kaladevi_3_Extracted.chunks.jsonl).Count
```

Read JSONL in Python:

```python
import json
with open("Judgement_of_Kaladevi_3_Extracted.chunks.jsonl", "r", encoding="utf-8") as f:
		for line in f:
				if line.strip():
						obj = json.loads(line)
						# obj["text"], obj["metadata"], ...
```

## Troubleshooting

- Error: Could not find config.json under the provided path
	- Point `--model-path` to the exact folder containing `config.json` (often a `snapshots/<rev>` subfolder). The app searches a few levels deep, but direct paths are most reliable.
- Error: 'conda' not found. Please ensure Conda is installed and available on PATH.
	- Install Miniconda and reopen PowerShell, or run from an Anaconda Prompt. The NER step uses `conda run -n ner_env ...`.
- spaCy model not found (e.g., en_legal_ner_trf)
	- Install your legal model into `ner_env` or temporarily switch to `--spacy-model en_core_web_sm` to validate the pipeline.
- Neo4j authentication errors
	- Verify URI/user/password. Start your DB and confirm Bolt is on `bolt://localhost:7687`.
- Empty Chroma results
	- Make sure you ran steps C and D (embed then chroma). Confirm the Chroma path/collection match the ones used in retrieval.
- Reset the vector store
	- Stop any running process and delete the `.chroma` folder. Re‑run steps C and D.

## Command reference (all modes)

General form:

```powershell
python -m app.main --mode <docx|json|embed|chroma|ner|neo4j|retrieve> [options]
```

Common options by mode:
- docx: `--input`, `--output?`, `--chunk-size`, `--chunk-overlap`
- json: `--input`, `--output?`, `--chunk-size`, `--chunk-overlap`
- embed: `--input`, `--output?`, `--model-path`, `--batch-size?`, `--device?`
- chroma: `--input`, `--chroma-path .\\.chroma`, `--collection kaladevi`, `--batch-size?`
- ner: `--input`, `--output?`, `--framework spacy|transformers`, `--spacy-model` or `--ner-model-path`, `--ner-env ner_env`, `--batch-size?`, `--device?`
- neo4j: `--input`, `--neo4j-uri`, `--neo4j-user`, `--neo4j-password`, `--batch-size?`, `--neo4j-database?`
- retrieve: `--query`, `--output retrieved.txt`, `--framework/spacy-model/ner-env`, `--model-path`, `--device?`, `--top-k?`, `--chroma-path`, `--collection`, `--neo4j-*`, `--kg-limit?`, `--strict-match/--no-strict-match`

## How it works (short)

- Split: LangChain RecursiveCharacterTextSplitter → chunks with metadata (`doc_id`, `chunk_id`, timestamps, splitter config)
- Embed: Transformers AutoModel + mean pool + L2 normalize → embeddings.jsonl
- Chroma: Persistent collection stores ids `doc_id:chunk_id` + vectors + metadata
- NER: spaCy pipeline with an EntityRuler + model (in `ner_env`) outputs entities with provenance
- Neo4j: Upserts Document/Chunk/Entity and Alias/PhoneticAlias nodes; creates MENTIONS edges with offsets and source
- Retrieve: Runs NER on the query, embeds the query, asks Chroma and Neo4j, then merges results (KG‑first) and writes a readable `retrieved.txt`

That’s it. If you follow steps A→G with your local paths, you’ll have a working hybrid retrieval system on your machine.