import express from "express";
import fetch from "node-fetch";
import OpenAI from "openai";

import { logSearchSession, logAuditEvent } from "../db.js";

export const ragRouter = express.Router();

// -------- env helpers --------
const env = (key, def) => (process.env[key] ?? def);
const bool = (key, def = false) => {
  const value = (process.env[key] || "").toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return def;
};

const BASE_RETRIEVAL_URL = env("RETRIEVAL_SERVICE_URL", "http://localhost:8000").replace(/\/$/, "");
const PY_RETRIEVE_URL = `${BASE_RETRIEVAL_URL}/retrieve`;

// chroma config (local-mode)
const CHROMA_PATH = env("CHROMA_PATH", "");
const CHROMA_COLLECTION = env("CHROMA_COLLECTION", "");

// embedding model for Python service
const EMBED_MODEL_PATH =
  env("EMBED_MODEL_PATH", null) ||
  env("EMBEDDING_MODEL_PATH", null) ||
  env("PIPELINE_MODEL_PATH", null);

// Neo4j flag (the FastAPI process reads its own NEO4J_* envs; we only log)
const HAS_NEO4J = Boolean(env("NEO4J_URI", null) || env("PIPELINE_NEO4J_URI", null));

// answer synthesis fallback (OpenAI)
const OPENAI_API_KEY = env("OPENAI_API_KEY", "");
const RAG_OPENAI_MODEL = env("RAG_OPENAI_MODEL", "gpt-4o-mini");
const RAG_TEMPERATURE = Number(env("RAG_TEMPERATURE", "0.2"));
const RAG_MAX_TOKENS = Number(env("RAG_MAX_TOKENS", "800"));

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

async function baselineAnswer(userQuestion) {
  if (!openai) return null;
  const resp = await openai.chat.completions.create({
    model: RAG_OPENAI_MODEL,
    temperature: RAG_TEMPERATURE,
    max_tokens: RAG_MAX_TOKENS,
    messages: [
      { role: "system", content: "You are LegalGenie, a concise, precise legal research assistant. If unsure, say so." },
      { role: "user", content: userQuestion },
    ],
  });
  return resp.choices?.[0]?.message?.content?.trim() || null;
}

function workspaceFrom(body) {
  return body?.projectId || body?.workspaceId || null;
}

const META_WHITELIST = [
  "doc_id",
  "document_id",
  "source_id",
  "source_path",
  "source_path_relative",
  "collection",
  "doc_type",
  "doctype",
  "citation",
  "cite",
  "case_number",
  "upload_id",
  "chunk_index",
  "chunk_id",
  "page",
  "page_number",
  "page_label",
  "page_index",
  "title",
  "court",
  "judge",
  "date",
];

const toStringOrNull = (value) => {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length ? str : null;
};

function pickMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  const picked = {};
  for (const key of META_WHITELIST) {
    if (meta[key] !== undefined && meta[key] !== null) picked[key] = meta[key];
  }
  return picked;
}

const ensureArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item) => item != null).map((item) => String(item));
  return [String(value)];
};

const computeSimilarity = (doc) => {
  const candidates = [doc?.score, doc?.similarity, doc?.sim_score];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && !Number.isNaN(Number(candidate))) {
      const num = Number(candidate);
      if (Number.isFinite(num)) return Math.max(0, Math.min(1, num));
    }
  }
  const distance = doc?.distance ?? doc?.metric_distance;
  if (distance !== undefined && distance !== null && !Number.isNaN(Number(distance))) {
    const dist = Number(distance);
    if (Number.isFinite(dist)) {
      if (dist >= 0 && dist <= 1) return Math.max(0, 1 - dist);
      return 1 / (1 + Math.max(dist, 0));
    }
  }
  return 0;
};

const baseFromPath = (value) => {
  const str = toStringOrNull(value);
  if (!str) return null;
  const last = str.split(/[\\/]/).pop();
  if (!last) return null;
  return last.replace(/\.[^.]+$/, "");
};

const extractDocId = (doc, fallback) => {
  const meta = doc?.meta || {};
  return (
    toStringOrNull(doc?.doc_id) ||
    toStringOrNull(meta.doc_id) ||
    toStringOrNull(meta.document_id) ||
    toStringOrNull(doc?.id) ||
    toStringOrNull(doc?.uuid) ||
    `doc-${fallback}`
  );
};

const extractChunkId = (doc, fallback) => {
  const meta = doc?.meta || {};
  return (
    toStringOrNull(doc?.chunk_id) ||
    toStringOrNull(meta.chunk_id) ||
    toStringOrNull(meta.chunk_index) ||
    toStringOrNull(doc?.chunk_index) ||
    `chunk-${fallback}`
  );
};

const normalizeDocKeyCandidate = (value) => {
  const str = toStringOrNull(value);
  if (!str) return null;
  const trimmed = str.trim();
  if (!trimmed) return null;
  const withoutDoubleColon = trimmed.includes('::') ? trimmed.split('::')[0].trim() : trimmed;
  const withoutHash = withoutDoubleColon.includes('#') ? withoutDoubleColon.split('#')[0].trim() : withoutDoubleColon;
  return withoutHash || trimmed;
};

const extractTitle = (doc) => {
  const meta = doc?.meta || {};
  return (
    toStringOrNull(doc?.title) ||
    toStringOrNull(meta.title) ||
    baseFromPath(meta.source_path_relative) ||
    baseFromPath(meta.source_path) ||
    "Untitled"
  );
};

const extractSnippet = (doc) => {
  return (
    toStringOrNull(doc?.snippet) ||
    toStringOrNull(doc?.text) ||
    toStringOrNull(doc?.content) ||
    ""
  );
};

function shapeChunks(rawDocs, limit) {
  const docs = Array.isArray(rawDocs) ? rawDocs : [];
  const normalized = docs.map((doc, index) => {
    const meta = doc?.meta && typeof doc.meta === "object" ? doc.meta : {};
    const similarity = computeSimilarity(doc);
    const scorePct = Math.round(similarity * 1000) / 10;
    const langs = [
      ...ensureArray(doc?.langs),
      ...ensureArray(meta?.langs),
    ].map((lang) => lang.toUpperCase());
    const uniqueLangs = Array.from(new Set(langs.length ? langs : ["EN"]));
    const citation =
      toStringOrNull(doc?.citation) ||
      toStringOrNull(meta?.citation) ||
      toStringOrNull(meta?.cite) ||
      null;
    const docType =
      toStringOrNull(doc?.doc_type) ||
      toStringOrNull(meta?.doc_type) ||
      toStringOrNull(meta?.doctype) ||
      null;
    const uploadId =
      toStringOrNull(meta?.upload_id) ||
      toStringOrNull(meta?.source_id) ||
      toStringOrNull(meta?.document_id) ||
      toStringOrNull(meta?.doc_id) ||
      null;
    const path =
      toStringOrNull(meta?.source_path_relative) ||
      toStringOrNull(meta?.source_path) ||
      toStringOrNull(doc?.path) ||
      null;
    const baseDocId = extractDocId(doc, index);
    const docKey =
      toStringOrNull(uploadId) ||
      normalizeDocKeyCandidate(meta?.doc_key) ||
      normalizeDocKeyCandidate(meta?.document_id) ||
      normalizeDocKeyCandidate(meta?.doc_id) ||
      normalizeDocKeyCandidate(doc?.doc_key) ||
      normalizeDocKeyCandidate(doc?.document_id) ||
      normalizeDocKeyCandidate(doc?.doc_id) ||
      toStringOrNull(path) ||
      normalizeDocKeyCandidate(baseDocId) ||
      `doc-${index}`;
    const chunkId = extractChunkId(doc, index);
    const chunk = {
      id: chunkId,
      docId: docKey,
      docKey,
      rawDocId: normalizeDocKeyCandidate(baseDocId) || docKey,
      chunkId,
      chunkIndex: meta?.chunk_index ?? meta?.index ?? doc?.chunk_index ?? null,
      similarity,
      score: scorePct,
      distance: doc?.distance !== undefined && doc?.distance !== null && Number.isFinite(Number(doc.distance))
        ? Number(doc.distance)
        : null,
      title: extractTitle(doc),
      snippet: extractSnippet(doc),
      court: toStringOrNull(doc?.court) || toStringOrNull(meta?.court) || "",
      judge: toStringOrNull(doc?.judge) || toStringOrNull(meta?.judge) || "",
      date: toStringOrNull(doc?.date) || toStringOrNull(meta?.date) || "",
      langs: uniqueLangs,
      page: meta?.page ?? meta?.page_number ?? meta?.page_label ?? null,
      citation,
      docType,
      uploadId,
      path,
      metadata: pickMeta(meta),
    };
    return chunk;
  });

  normalized.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
  const max = Number.isFinite(Number(limit)) ? Number(limit) : normalized.length;
  return normalized.slice(0, Math.max(0, max));
}
function shapeDocuments(chunks, limit) {
  const byDoc = new Map();
  for (const chunk of chunks) {
    const docId = chunk.docKey || chunk.docId || chunk.rawDocId || chunk.id;
    if (!docId) continue;
    let entry = byDoc.get(docId);
    if (!entry) {
      entry = {
        id: docId,
        title: chunk.title,
        bestSimilarity: chunk.similarity ?? 0,
        score: chunk.score ?? 0,
        snippet: chunk.snippet,
        court: chunk.court || "",
        judge: chunk.judge || "",
        date: chunk.date || "",
        langs: new Set(chunk.langs || ["EN"]),
        path: chunk.path || null,
        citationPrimary: chunk.citation || null,
        docType: chunk.docType || null,
        uploadId: chunk.uploadId || null,
        metadata: { ...chunk.metadata },
        citations: new Set(chunk.citation ? [chunk.citation] : []),
        chunks: [],
        chunkIds: new Set(),
      };
      byDoc.set(docId, entry);
    }

    entry.bestSimilarity = Math.max(entry.bestSimilarity, chunk.similarity ?? 0);
    entry.score = Math.max(entry.score, chunk.score ?? 0);
    if ((chunk.similarity ?? 0) >= entry.bestSimilarity - 1e-6 && chunk.snippet) {
      entry.snippet = chunk.snippet;
    }
    if (!entry.title && chunk.title) entry.title = chunk.title;
    if (!entry.court && chunk.court) entry.court = chunk.court;
    if (!entry.judge && chunk.judge) entry.judge = chunk.judge;
    if (!entry.date && chunk.date) entry.date = chunk.date;
    if (!entry.path && chunk.path) entry.path = chunk.path;
    if (!entry.docType && chunk.docType) entry.docType = chunk.docType;
    if (!entry.uploadId && chunk.uploadId) entry.uploadId = chunk.uploadId;
    if (!entry.citationPrimary && chunk.citation) entry.citationPrimary = chunk.citation;

    for (const lang of chunk.langs || []) entry.langs.add(lang);
    if (chunk.citation) entry.citations.add(chunk.citation);
    const cited = chunk.metadata?.citations;
    if (Array.isArray(cited)) cited.filter(Boolean).forEach((c) => entry.citations.add(String(c)));

    entry.metadata = { ...entry.metadata, ...chunk.metadata };
    if (chunk.chunkId) entry.chunkIds.add(String(chunk.chunkId));
    entry.chunks.push(chunk);
  }

  const documents = Array.from(byDoc.values()).map((doc) => {
    doc.chunks.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
    const citationsArr = Array.from(doc.citations);
    const langsArr = Array.from(doc.langs.size ? doc.langs : new Set(["EN"]));
    const chunkIdsArr = Array.from(doc.chunkIds);
    const chunkCount = doc.chunks.length;
    const baseMetadata = doc.metadata && typeof doc.metadata === "object" && doc.metadata !== null ? doc.metadata : {};
    const metadata = {
      ...baseMetadata,
      citations: citationsArr,
      docType: doc.docType || baseMetadata.docType || null,
      uploadId: doc.uploadId || baseMetadata.uploadId || null,
      path: doc.path || baseMetadata.path || null,
      chunkCount,
      chunkIds: chunkIdsArr,
    };
    return {
      id: doc.id,
      docKey: doc.id,
      title: doc.title || `Document ${doc.id}`,
      snippet: doc.snippet || "",
      score: Math.round((doc.score ?? 0) * 10) / 10,
      similarity: doc.bestSimilarity ?? 0,
      court: doc.court || "",
      judge: doc.judge || "",
      date: doc.date || "",
      langs: langsArr,
      path: doc.path,
      citation: doc.citationPrimary || citationsArr[0] || null,
      citations: citationsArr,
      docType: doc.docType || null,
      uploadId: doc.uploadId || null,
      chunkCount,
      chunkIds: chunkIdsArr,
      metadata,
      chunks: doc.chunks,
    };
  });

  documents.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
  const max = Number.isFinite(Number(limit)) ? Number(limit) : documents.length;
  return documents.slice(0, Math.max(0, max));
}
const reshapeDocs = (rawDocs, limit) => {
  const chunks = shapeChunks(rawDocs, limit);
  const documents = shapeDocuments(chunks, limit);
  return { chunks, documents };
};

async function performRetrieval({
  req,
  query,
  topK = 12,
  projectId,
  docType,
  threadId,
  withAnswer = false,
  mode,
}) {
  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery) {
    return { status: 400, body: { error: "query required" } };
  }

  const workspaceId = projectId || workspaceFrom(req.body);
  const collection = CHROMA_COLLECTION || (projectId ? `workspace_${projectId}` : undefined);

  const payload = {
    query: trimmedQuery,
    k: topK,
    kg_limit: Number(req.body?.kg_limit ?? env("KG_LIMIT", "25")),
    strict_match: bool("STRICT_MATCH", false),
    chroma_path: CHROMA_PATH || undefined,
    collection: collection || undefined,
    with_answer: Boolean(withAnswer),
    ...(EMBED_MODEL_PATH ? { model_path: EMBED_MODEL_PATH, device: env("EMBED_DEVICE", "cpu") } : {}),
  };

  const started = Date.now();
  const logMode = mode || (withAnswer ? "ask-genie" : "document-search");

  console.log("[retrieval] ->", PY_RETRIEVE_URL, {
    query: trimmedQuery,
    k: payload.k,
    projectId: workspaceId,
    collection: payload.collection,
    chromaPath: payload.chroma_path,
    hasModelPath: Boolean(payload.model_path),
    hasNeo4j: HAS_NEO4J,
    kg_limit: payload.kg_limit,
    mode: logMode,
  });

  let py;
  try {
    const res = await fetch(PY_RETRIEVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    py = text ? JSON.parse(text) : {};
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[retrieval] fetch failed:", message);
    await logAuditEvent({
      actorId: req.user?.id || null,
      scopeType: "hybrid-rag",
      scopeId: null,
      action: "backend-unreachable",
      metadata: { error: message },
    }).catch(() => {});
    await logSearchSession({
      userId: req.user?.id || null,
      workspaceId,
      threadId: threadId || null,
      mode: logMode,
      queryText: trimmedQuery,
      topK,
      latencyMs: Date.now() - started,
      metadata: { error: message },
    }).catch(() => {});
    const fallback = withAnswer ? await baselineAnswer(trimmedQuery) : null;
    return {
      status: 200,
      body: {
        answer: fallback,
        documents: [],
        results: [],
        chunks: [],
        metadata: { source: withAnswer ? "baseline" : logMode, error: message },
      },
    };
  }

  const summary = {
    chroma_available: py?.chroma_available ?? py?.chroma ?? false,
    kg_available: py?.kg_available ?? py?.kg ?? false,
    source_counts: py?.source_counts || {},
    kg_requested_keys: py?.kg_requested_keys,
    kg_matched_keys: py?.kg_matched_keys,
    final_ids: py?.final_ids,
  };
  console.log("[retrieval] python summary:", summary);

  const rawDocs = py?.docs || py?.results || py?.documents || [];
  const { chunks, documents } = reshapeDocs(rawDocs, topK);
  const latencyMs = Date.now() - started;

  if (!chunks.length) {
    const fallback = withAnswer ? await baselineAnswer(trimmedQuery) : null;
    await logSearchSession({
      userId: req.user?.id || null,
      workspaceId,
      threadId: threadId || null,
      mode: withAnswer ? "baseline" : logMode,
      queryText: trimmedQuery,
      topK,
      latencyMs,
      metadata: { docType, py_summary: summary, count: 0, documents: [] },
    }).catch(() => {});
    console.log("[retrieval] no docs -> returning baseline/document only");
    return {
      status: 200,
      body: {
        answer: fallback,
        documents: [],
        results: [],
        chunks: [],
        metadata: { source: withAnswer ? "baseline" : logMode, summary },
      },
    };
  }

  let answer = null;
  if (withAnswer && openai) {
    try {
      const context = chunks
        .map((chunk, idx) => {
          const preview = (chunk.snippet || "").slice(0, 1200);
          return `#${idx + 1} [${chunk.docId}::${chunk.chunkId}] (score: ${chunk.similarity?.toFixed(3) ?? "0"})\n${preview}`;
        })
        .join("\n\n");
      const prompt = [
        "You are a legal assistant. Answer using only the context below.",
        "If the answer is not present, say you cannot find it.",
        "",
        "Context:",
        context,
        "",
        `Question: ${trimmedQuery}`,
      ].join("\n");

      const resp = await openai.chat.completions.create({
        model: RAG_OPENAI_MODEL,
        temperature: RAG_TEMPERATURE,
        max_tokens: RAG_MAX_TOKENS,
        messages: [
          { role: "system", content: "Answer concisely using the context. Prefer direct quotes and cite chunk ids like [#3]. If the context is insufficient, say you cannot find it." },
          { role: "user", content: prompt },
        ],
      });
      answer = resp.choices?.[0]?.message?.content?.trim() || null;
    } catch (error) {
      console.warn("[retrieval] LLM synthesis failed:", error?.message || error);
    }

    const cannotFind = (text) => /cannot\s+find/i.test(text || "");
    if ((!answer || cannotFind(answer)) && chunks.length) {
      try {
        const more = chunks.slice(0, Math.min(chunks.length, 20));
        const moreContext = more
          .map((chunk, idx) => `#${idx + 1} [${chunk.docId}::${chunk.chunkId}]\n${(chunk.snippet || "").slice(0, 1500)}`)
          .join("\n\n");
        const retryPrompt = [
          "From the context, extract the exact quoted sentence(s) that state the judgement/holding. If present, quote them verbatim and cite chunk ids like [#3]. If truly absent, say you cannot find it.",
          "",
          "Context:",
          moreContext,
        ].join("\n");
        const retry = await openai.chat.completions.create({
          model: RAG_OPENAI_MODEL,
          temperature: RAG_TEMPERATURE,
          max_tokens: RAG_MAX_TOKENS,
          messages: [
            { role: "system", content: "Be precise and quote directly when possible." },
            { role: "user", content: retryPrompt },
          ],
        });
        const second = retry.choices?.[0]?.message?.content?.trim() || null;
        if (second && !cannotFind(second)) answer = second;
      } catch (retryErr) {
        console.warn("[retrieval] retry synthesis failed:", retryErr?.message || retryErr);
      }
    }
  }

  const docSummaries = documents.map((doc) => ({
    id: doc.id,
    title: doc.title,
    score: doc.similarity ?? 0,
    scorePct: doc.score ?? 0,
    docType: doc.docType || null,
    path: doc.path || null,
    citation: doc.citation || null,
    chunkCount: doc.chunkCount ?? (Array.isArray(doc.chunks) ? doc.chunks.length : 0),
  }));

  await logSearchSession({
    userId: req.user?.id || null,
    workspaceId,
    threadId: threadId || null,
    mode: logMode,
    queryText: trimmedQuery,
    topK,
    latencyMs,
    reasoningModel: withAnswer && openai ? RAG_OPENAI_MODEL : null,
    metadata: { docType, py_summary: summary, count: chunks.length, documents: docSummaries },
  }).catch(() => {});

  console.log("[retrieval] ok", {
    docsCount: documents.length,
    mode: logMode,
    model: withAnswer && openai ? RAG_OPENAI_MODEL : null,
    latencyMs,
  });

  return {
    status: 200,
    body: {
      answer: answer ?? null,
      documents,
      results: documents,
      chunks,
      metadata: { source: logMode, summary },
    },
  };
}

// -------- routes --------
ragRouter.post("/retrieve", async (req, res) => {
  try {
    const { query, topK = 12, projectId, withAnswer = false, docType, threadId } = req.body || {};
    const result = await performRetrieval({
      req,
      query,
      topK,
      projectId,
      docType,
      threadId,
      withAnswer: Boolean(withAnswer),
      mode: Boolean(withAnswer) ? "ask-genie" : "document-search",
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("[retrieval] unexpected error:", error);
    return res.status(500).json({ error: error?.message || "retrieval failed" });
  }
});

ragRouter.post("/search", async (req, res) => {
  try {
    const { query, topK = 12, projectId, docType, threadId } = req.body || {};
    const result = await performRetrieval({
      req,
      query,
      topK,
      projectId,
      docType,
      threadId,
      withAnswer: false,
      mode: "document-search",
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error("[search] unexpected error:", error);
    return res.status(500).json({ error: error?.message || "search failed" });
  }
});

ragRouter.get("/retrieve", (_req, res) => {
  res.status(405).json({
    error: "Method Not Allowed",
    hint: "Use POST /api/hybrid-rag/retrieve with JSON { query, k, chroma_path, collection }",
  });
});

ragRouter.get("/search", (_req, res) => {
  res.status(405).json({
    error: "Method Not Allowed",
    hint: "Use POST /api/hybrid-rag/search with JSON { query, k }",
  });
});











