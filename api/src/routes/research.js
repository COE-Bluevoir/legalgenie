// /api/src/routes/research.js
import { Router } from "express";
import fetch from "node-fetch";
import { logSearchSession, logAuditEvent } from "../db.js";

export const researchRouter = Router();

// --- In-memory demo stores (replace with DB later) ---
let projects = [
  { id: "p1", name: "Pilot – DPDP & IT Act" },
  { id: "p2", name: "Arbitration – Section 9" },
];
let threads = [
  { id: "t1", projectId: "p1", title: "Damages under S.73" },
  { id: "t2", projectId: "p1", title: "Penalty vs Liquidated" },
  { id: "t3", projectId: "p2", title: "Emergency Arbitrator" },
];
let files = [
  { id: "u1", projectId: "p1", name: "Client_Contract.pdf", size: 234000 }
];
let briefItems = [
  // { id: "b1", projectId:"p1", threadId:"t1", type:"case", refId:"SC2021-123", title:"ACME v State of X" }
];
let attention = [
  // { id:"a1", projectId:"p1", message:"Low OCR confidence on Clause 7", severity:"warn" }
];

// Environment helpers for retrieval + LLM
const fromEnv = (name, fallback) => {
  const raw = process.env[name];
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  return trimmed ? trimmed : fallback;
};

const ASK_RETRIEVE_URL = fromEnv("ASK_RETRIEVE_URL", fromEnv("RAG_RETRIEVE_URL", fromEnv("RETRIEVAL_SERVICE_URL", "http://localhost:8000/retrieve")));
const EMBED_MODEL_PATH = fromEnv("EMBED_MODEL_PATH", null);
const OPENAI_MODEL = fromEnv("OPENAI_MODEL", "gpt-4o-mini");
const OPENAI_BASE_URL = fromEnv("OPENAI_BASE_URL", "https://api.openai.com/v1");
const ASK_TEMPERATURE = Number.parseFloat(fromEnv("ASK_TEMPERATURE", "0"));
const ASK_MAX_TOKENS = Number.parseInt(fromEnv("ASK_MAX_TOKENS", "512"), 10);
const ASK_CONTEXT_SNIPPET = Number.parseInt(fromEnv("ASK_CONTEXT_CHARS", "600"), 10);
// tiny helper
const id = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;

// ---------------- Projects ----------------
researchRouter.get("/projects", (req, res) => {
  res.json({ projects });
});

researchRouter.post("/projects", (req, res) => {
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  const p = { id: id("p"), name };
  projects.push(p);
  res.json(p);
});

researchRouter.patch("/projects/:id", (req, res) => {
  const p = projects.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  if (typeof req.body?.name === "string") p.name = req.body.name.trim();
  res.json(p);
});

researchRouter.delete("/projects/:id", (req, res) => {
  const pid = req.params.id;
  projects = projects.filter((x) => x.id !== pid);
  threads = threads.filter((t) => t.projectId !== pid);
  files   = files.filter((f) => f.projectId !== pid);
  briefItems = briefItems.filter((b) => b.projectId !== pid);
  attention  = attention.filter((a) => a.projectId !== pid);
  res.json({ ok: true });
});

// ---------------- Threads ----------------
researchRouter.get("/projects/:id/threads", (req, res) => {
  res.json({ threads: threads.filter((t) => t.projectId === req.params.id) });
});

researchRouter.post("/projects/:id/threads", (req, res) => {
  const title = (req.body?.title || "").trim();
  if (!title) return res.status(400).json({ error: "title required" });
  const t = { id: id("t"), projectId: req.params.id, title };
  threads.push(t);
  res.json(t);
});

researchRouter.patch("/threads/:id", (req, res) => {
  const t = threads.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "not found" });
  if (typeof req.body?.title === "string") t.title = req.body.title.trim();
  res.json(t);
});

researchRouter.delete("/threads/:id", (req, res) => {
  threads = threads.filter((x) => x.id !== req.params.id);
  briefItems = briefItems.filter((b) => b.threadId !== req.params.id);
  res.json({ ok: true });
});

// ---------------- Files (metadata only here) ----------------
researchRouter.get("/projects/:id/files", (req, res) => {
  res.json({ files: files.filter((f) => f.projectId === req.params.id) });
});

researchRouter.post("/projects/:id/files", (req, res) => {
  // In real app: presign + upload flow; here we accept metadata
  const { name, size } = req.body || {};
  if (!name || typeof size !== "number") return res.status(400).json({ error: "name & size required" });
  const f = { id: id("u"), projectId: req.params.id, name, size };
  files.unshift(f);
  // Optionally create an "attention" item if something looks off
  res.json(f);
});

// ---------------- Ask (RAG chat for thread) ----------------
researchRouter.post("/ask", async (req, res) => {
  const { question, threadId = null, k = 6, strictCitations = true, projectId = null } = req.body || {};
  const query = typeof question === "string" ? question.trim() : "";
  if (!query) {
    return res.status(400).json({ error: "question required" });
  }

  const topKRaw = Number(k);
  const topK = Number.isFinite(topKRaw) ? Math.min(Math.max(Math.trunc(topKRaw), 1), 20) : 6;
  const strictMatch = strictCitations !== false;
  const snippetLimit = Number.isFinite(ASK_CONTEXT_SNIPPET) && ASK_CONTEXT_SNIPPET > 0 ? ASK_CONTEXT_SNIPPET : 600;

  const started = Date.now();
  const payload = {
    query,
    k: topK,
    strict_match: strictMatch,
    with_answer: false,
  };
  if (projectId) payload.project_id = projectId;
  if (threadId) payload.thread_id = threadId;
  if (EMBED_MODEL_PATH) payload.model_path = EMBED_MODEL_PATH;

  let retrieval = null;
  let retrievalError = null;

  try {
    const response = await fetch(ASK_RETRIEVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      retrieval = await response.json();
    } else {
      const detail = await response.text().catch(() => "");
      retrievalError = detail || `retrieval service responded with HTTP ${response.status}`;
    }
  } catch (err) {
    retrievalError = err?.message || "retrieval service unreachable";
  }

  if (retrievalError) {
    await logAuditEvent({
      actorId: req.user?.id || null,
      scopeType: "research-ask",
      scopeId: threadId || null,
      action: "retrieval-error",
      metadata: { query, error: retrievalError },
    }).catch(() => {});
    return res.status(502).json({ error: retrievalError });
  }

  const docs = Array.isArray(retrieval?.docs) ? retrieval.docs : [];
  const limitedDocs = docs.slice(0, topK);
  const sourceCounts = retrieval?.source_counts || retrieval?.metadata || {};
  const provenanceCounts = {
    chroma: sourceCounts?.chroma ?? null,
    kg: sourceCounts?.kg ?? null,
    both: sourceCounts?.both ?? null,
  };

  if (limitedDocs.length === 0) {
    const message = "No supporting context was found for that question. Try rephrasing or re-ingesting sources.";
    await logSearchSession({
      userId: req.user?.id || null,
      workspaceId: projectId || null,
      threadId: threadId || null,
      mode: "ask",
      queryText: query,
      topK,
      latencyMs: Date.now() - started,
      reasoningModel: null,
      metadata: { source_counts: provenanceCounts },
    }).catch(() => {});


    return res.json({
      answer: message,
      sources: [],
      threadId,
      k: topK,
      strictCitations,
      metadata: {
        retrieval: {
          source_counts: provenanceCounts,
          chroma_available: retrieval?.chroma_available ?? null,
          kg_available: retrieval?.kg_available ?? null,
          strict_match: strictMatch,
          note: "empty-context",
        },
      },
    });
  }

  const contextBlocks = limitedDocs
    .map((doc, idx) => {
      const rawSnippet = String(doc.snippet || doc.text || "").replace(/\s+/g, " " ).trim();
      const truncated = snippetLimit > 0 ? rawSnippet.slice(0, snippetLimit) : rawSnippet;
      const provenance = Array.isArray(doc.provenance)
        ? doc.provenance.join("+")
        : doc.provenance
        ? String(doc.provenance)
        : "";
      const titlePart = doc.title ? `, title: ${doc.title}` : "";
      const provenancePart = provenance ? `, provenance: ${provenance}` : "";
      return `S${idx + 1} (id: ${doc.id}${titlePart}${provenancePart}) -> ${truncated}`;
    })
    .join("\n\n");

  const detailedSources = limitedDocs.map((doc, idx) => ({
    id: doc.id || `source-${idx + 1}`,
    cite: doc.title || `Source ${idx + 1}`,
    span: String(doc.snippet || doc.text || "").slice(0, 280),
    provenance: doc.provenance || [],
  }));
  const responseSources = detailedSources.map(({ provenance, ...rest }) => rest);
  const provenanceMap = Object.fromEntries(
    detailedSources
      .filter((entry) => entry?.id && Array.isArray(entry.provenance) && entry.provenance.length)
      .map((entry) => [entry.id, entry.provenance])
  );


  const openaiKey = fromEnv("OPENAI_API_KEY", null);
  if (!openaiKey) {
    await logAuditEvent({
      actorId: req.user?.id || null,
      scopeType: "research-ask",
      scopeId: threadId || null,
      action: "llm-misconfigured",
      metadata: { query },
    }).catch(() => {});
    return res.status(500).json({
      error: "OPENAI_API_KEY env var is required for /api/research/ask",
      sources: responseSources,
      threadId,
      k: topK,
      strictCitations,
    });
  }

  const temperature = Number.isFinite(ASK_TEMPERATURE) ? ASK_TEMPERATURE : 0;
  const maxTokens = Number.isFinite(ASK_MAX_TOKENS) && ASK_MAX_TOKENS > 0 ? ASK_MAX_TOKENS : 512;
  const baseUrl = OPENAI_BASE_URL.endsWith("/") ? OPENAI_BASE_URL.slice(0, -1) : OPENAI_BASE_URL;
  const openaiUrl = `${baseUrl}/chat/completions`;

  const messages = [
    {
      role: "system",
      content:
        "You are a meticulous Indian legal research assistant. Use only the provided sources to answer. Cite each relevant statement using [S#]. If the answer cannot be inferred, say so plainly.",
    },
    {
      role: "user",
      content: `Question: ${query}\n\nSources:\n${contextBlocks}\n\nInstructions:\n- Cite supporting passages using [S#].${strictMatch ? "\n- Stay strictly within the sources." : ""}\n- Present a concise, structured answer covering holdings, reasoning, and statutory references when available.`,
    },
  ];

  let answer = "";
  try {
    const completion = await fetch(openaiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!completion.ok) {
      const detail = await completion.text().catch(() => "");
      throw new Error(detail || `OpenAI returned HTTP ${completion.status}`);
    }

    const completionJson = await completion.json();
    answer = completionJson?.choices?.[0]?.message?.content?.trim() || "";
  } catch (err) {
    const message = err?.message || "OpenAI request failed";
    await logAuditEvent({
      actorId: req.user?.id || null,
      scopeType: "research-ask",
      scopeId: threadId || null,
      action: "llm-error",
      metadata: { query, error: message },
    }).catch(() => {});
    return res.status(502).json({
      error: message,
      sources: responseSources,
      threadId,
      k: topK,
      strictCitations,
    });
  }

  await logSearchSession({
    userId: req.user?.id || null,
    workspaceId: projectId || null,
    threadId: threadId || null,
    mode: "ask",
    queryText: query,
    topK,
    latencyMs: Date.now() - started,
    reasoningModel: OPENAI_MODEL,
    metadata: { source_counts: provenanceCounts },
  }).catch(() => {});

  const retrievalMeta = {
    source_counts: provenanceCounts,
    chroma_available: retrieval?.chroma_available ?? null,
    kg_available: retrieval?.kg_available ?? null,
    strict_match: strictMatch,
    ids: responseSources.map((s) => s.id),
    service_url: ASK_RETRIEVE_URL,
  };
  if (retrieval?.kg_error) retrievalMeta.kg_error = retrieval.kg_error;
  if (retrieval?.chroma_error) retrievalMeta.chroma_error = retrieval.chroma_error;
  if (retrieval?.source_counts?.selected !== undefined) retrievalMeta.selected = retrieval.source_counts.selected;
  if (retrieval?.kg_matched_keys) retrievalMeta.kg_matched_keys = retrieval.kg_matched_keys;
  if (retrieval?.kg_requested_keys) retrievalMeta.kg_requested_keys = retrieval.kg_requested_keys;
  if (Object.keys(provenanceMap).length) retrievalMeta.provenance = provenanceMap;

  return res.json({
    answer: answer || "I could not determine an answer from the available sources.",
    sources: responseSources,
    threadId,
    k: topK,
    strictCitations,
    metadata: {
      retrieval: retrievalMeta,
    },
  });
});
// ---------------- Brief (pin items for project/thread) ----------------
researchRouter.get("/brief", (req, res) => {
  const { projectId, threadId } = req.query;
  let items = briefItems.slice();
  if (projectId) items = items.filter((b) => b.projectId === projectId);
  if (threadId)  items = items.filter((b) => b.threadId === threadId);
  res.json({ items });
});

researchRouter.post("/brief", (req, res) => {
  const { projectId, threadId, type, refId, title } = req.body || {};
  if (!projectId || !type || !refId) return res.status(400).json({ error: "projectId, type, refId required" });
  const item = { id: id("b"), projectId, threadId: threadId || null, type, refId, title: title || "" };
  briefItems.unshift(item);
  res.json(item);
});

researchRouter.delete("/brief/:id", (req, res) => {
  briefItems = briefItems.filter((b) => b.id !== req.params.id);
  res.json({ ok: true });
});

// ---------------- Needs Attention ----------------
researchRouter.get("/needs-attention", (req, res) => {
  const { projectId } = req.query;
  const items = projectId ? attention.filter((a) => a.projectId === projectId) : attention;
  res.json({ items });
});

researchRouter.post("/needs-attention", (req, res) => {
  const { projectId, message, severity = "warn" } = req.body || {};
  if (!projectId || !message) return res.status(400).json({ error: "projectId & message required" });
  const a = { id: id("attn"), projectId, message, severity };
  attention.unshift(a);
  res.json(a);
});

researchRouter.delete("/needs-attention/:id", (req, res) => {
  attention = attention.filter((a) => a.id !== req.params.id);
  res.json({ ok: true });
});


