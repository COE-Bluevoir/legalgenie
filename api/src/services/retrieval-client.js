import fetch from "node-fetch";
import path from "node:path";

function env(name, def) { return process.env[name] || def; }

// Python FastAPI base (don’t collide with any Chroma HTTP port)
const PY_BASE = (env("RETRIEVAL_SERVICE_URL", "") || "").replace(/\/$/, "") || "http://localhost:8000";
const PY_RETRIEVE_URL = `${PY_BASE}/retrieve`;

// Model path: accept any of these envs
const MODEL_PATH =
  process.env.EMBED_MODEL_PATH ||
  process.env.EMBEDDING_MODEL_PATH ||
  process.env.PIPELINE_MODEL_PATH ||
  null;

// Chroma path: mirror ingestion defaults
const PIPELINE_ROOT = process.env.PIPELINE_ROOT
  ? path.resolve(process.env.PIPELINE_ROOT)
  : path.resolve(process.cwd(), "..", "lg_pipeline");
const CHROMA_PATH = process.env.PIPELINE_CHROMA_PATH
  ? path.resolve(process.env.PIPELINE_CHROMA_PATH)
  : path.join(PIPELINE_ROOT, ".chroma");

// Collection naming like ingestion
const COLLECTION_PREFIX = env("PIPELINE_COLLECTION_PREFIX", "workspace_");
//const FORCED_COLLECTION = process.env.CHROMA_COLLECTION || null;

export async function retrieveHybrid({ query, k = 12, projectId, docType, withAnswer = true, kg_limit }) {
  const collection = FORCED_COLLECTION || (projectId ? `${COLLECTION_PREFIX}${projectId}` : undefined);

  const payload = {
    query,
    k,
    with_answer: !!withAnswer,
    project_id: projectId,         // still useful server-side
    doc_type: docType,
    ...(MODEL_PATH ? { model_path: MODEL_PATH } : {}),
    ...(collection ? { collection } : {}),
    ...(CHROMA_PATH ? { chroma_path: CHROMA_PATH } : {}),
    ...(kg_limit != null ? { kg_limit: Number(kg_limit) } : {}),
  };

  const started = Date.now();
  try {
    console.log("[retrieval] →", PY_RETRIEVE_URL, {
      q: query.slice(0, 80),
      k,
      projectId,
      collection,
      chromaPath: CHROMA_PATH,
      hasModelPath: !!MODEL_PATH,
    });

    const resp = await fetch(PY_RETRIEVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const latencyMs = Date.now() - started;
    if (!resp.ok) {
      const msg = await resp.text().catch(() => `HTTP ${resp.status}`);
      console.error("[retrieval] Python error:", msg);
      return { ok: false, error: msg, latencyMs };
    }

    const data = await resp.json();
    const docs = data.docs || data.results || data.documents || [];
    console.log("[retrieval] ✓", { docsCount: docs.length, model: data.model || null, latencyMs });
    return { ok: true, latencyMs, data: { answer: data.answer ?? null, docs, model: data.model || null } };
  } catch (err) {
    const msg = err?.message || String(err);
    console.error("[retrieval] fetch failed:", msg);
    return { ok: false, error: msg, latencyMs: Date.now() - started };
  }
}
