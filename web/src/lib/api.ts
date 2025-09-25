import { useState } from "react";

export type ApiOk<T> = { ok: true; data: T; status?: number };
export type ApiErr = { ok: false; error: string; status?: number };
export type ApiResult<T> = ApiOk<T> | ApiErr;

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  role?: string | null;
};

export type AuthState = {
  token: string | null;
  user: AuthUser | null;
};

export type AdminIngestionJob = {
  id: string;
  uploadId: string;
  stage: string;
  status: string;
  detail: Record<string, any> | null;
  startedAt?: string | null;
  completedAt?: string | null;
  workspaceId?: string | null;
  filename?: string | null;
  uploadStatus?: string | null;
};

export type AdminChunkItem = {
  index: number;
  text: string;
  metadata: Record<string, any> | null;
};

export type AdminChunksResponse = {
  jobId: string;
  uploadId: string;
  filename?: string | null;
  workspaceId?: string | null;
  threadId?: string | null;
  docId?: string | null;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  chunkPath: string;
  items: AdminChunkItem[];
};

export type AdminKgMention = {
  entityKey?: string;
  label?: string;
  text?: string;
  normText?: string;
  start?: number | null;
  end?: number | null;
  score?: number | null;
  source?: string | null;
};

export type AdminKgChunk = {
  id: string;
  chunkId: string | number | null;
  chunkIndex: number | null;
  totalChunks: number | null;
  text: string | null;
  metadata: Record<string, any> | null;
  mentions: AdminKgMention[];
};

export type AdminKgEntity = {
  key?: string;
  label?: string;
  text?: string;
  norm_text?: string;
  normText?: string;
  mentionCount: number;
  chunkCount: number;
  aliasCount: number;
  phoneticCount: number;
  [key: string]: any;
};

export type AdminKgResponse = {
  jobId: string;
  uploadId: string;
  docId: string;
  document: Record<string, any> | null;
  chunks: AdminKgChunk[];
  entities: AdminKgEntity[];
};

export type HybridChunkResult = {
  id?: string | null;
  docId: string;
  docKey?: string | null;
  rawDocId?: string | null;
  chunkId?: string | null;
  chunkIndex?: number | null;
  similarity?: number | null;
  score?: number | null;
  title?: string | null;
  snippet?: string;
  citation?: string | null;
  docType?: string | null;
  uploadId?: string | null;
  path?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type HybridDocumentResult = {
  id: string;
  docKey?: string | null;
  title: string;
  snippet: string;
  score: number;
  similarity?: number | null;
  court?: string;
  judge?: string;
  date?: string;
  langs?: string[];
  path?: string | null;
  citation?: string | null;
  citations?: string[];
  docType?: string | null;
  uploadId?: string | null;
  chunkCount?: number;
  chunkIds?: string[];
  metadata?: Record<string, unknown> | null;
  chunks?: HybridChunkResult[];
};


const DEFAULT_API_BASE =
  (typeof window !== "undefined" && (window as any).VITE_API_BASE) ||
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_BASE) ||
  (typeof window !== "undefined" ? `${window.location.origin}` : "http://localhost:8787");

export const API_BASE_URL = String(DEFAULT_API_BASE || "http://localhost:8787").replace(/\/$/, "");

let AUTH_TOKEN: string | null = null;
let AUTH_USER: AuthUser | null = null;

if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
  AUTH_TOKEN = localStorage.getItem("lg_token");
  try {
    const storedUser = localStorage.getItem("lg_user");
    AUTH_USER = storedUser ? (JSON.parse(storedUser) as AuthUser) : null;
  } catch {
    AUTH_USER = null;
  }
}

const authSubscribers = new Set<(state: AuthState) => void>();

function notifyAuthSubscribers() {
  const snapshot: AuthState = { token: AUTH_TOKEN, user: AUTH_USER };
  authSubscribers.forEach((callback) => {
    try {
      callback(snapshot);
    } catch (err) {
      console.error("Auth subscriber error", err);
    }
  });
}

export function getAuthState(): AuthState {
  return { token: AUTH_TOKEN, user: AUTH_USER };
}

export function subscribeAuth(callback: (state: AuthState) => void) {
  authSubscribers.add(callback);
  return () => { authSubscribers.delete(callback); };
}

export function setAuthSession(token: string, user: AuthUser) {
  AUTH_TOKEN = token;
  AUTH_USER = user;
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    localStorage.setItem("lg_token", token);
    localStorage.setItem("lg_user", JSON.stringify(user));
  }
  notifyAuthSubscribers();
}

export function clearAuthSession() {
  AUTH_TOKEN = null;
  AUTH_USER = null;
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    localStorage.removeItem("lg_token");
    localStorage.removeItem("lg_user");
  }
  notifyAuthSubscribers();
}

function buildHeaders(init?: RequestInit) {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (AUTH_TOKEN && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${AUTH_TOKEN}`);
  return headers;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const bodyIsFormData = typeof FormData !== "undefined" && init.body instanceof FormData;

  const headers = buildHeaders(init);
  if (!bodyIsFormData && init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const requestInit: RequestInit = {
    ...init,
    headers,
  };

  try {
    const res = await fetch(url, requestInit);
    const status = res.status;
    const text = await res.text();

    if (!res.ok) {
      let message = text;
      try {
        const parsed = text ? JSON.parse(text) : null;
        message = parsed?.error || message;
      } catch {
        // ignore parsing errors
      }
      return { ok: false, error: message || `HTTP ${status}`, status } as ApiErr;
    }

    const data = text ? (JSON.parse(text) as T) : (undefined as unknown as T);
    return { ok: true, data, status } as ApiOk<T>;
  } catch (err: any) {
    return { ok: false, error: err?.message || "Network error" } as ApiErr;
  }
}

export function useApiAction<A, R>(fn: (args: A) => Promise<ApiResult<R>>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<R | null>(null);
  const [status, setStatus] = useState<number | undefined>(undefined);

  const execute = async (args: A) => {
    setLoading(true);
    setError(null);
    setStatus(undefined);
    const result = await fn(args);
    setLoading(false);
    if (result.ok) {
      setData(result.data);
    } else {
      setError(result.error);
      setStatus(result.status);
    }
    return result;
  };

  return { execute, loading, error, data, setData, status } as const;
}

export const AuthAPI = {
  login: async (credentials: { email: string; password: string }) => {
    const result = await api<{ token: string; user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    });
    if (result.ok) {
      setAuthSession(result.data.token, result.data.user);
    }
    return result;
  },
  logout: () => {
    clearAuthSession();
    return Promise.resolve({ ok: true, data: { ok: true } } as ApiOk<{ ok: true }>);
  },
};

export const VectorAPI = {
  search: (body: { query: string; topK?: number; projectId?: string; docType?: string; filters?: Record<string, any> }) =>
    api<{ results: Array<{ id: string; title: string; snippet: string; score: number; court?: string; judge?: string; date?: string; langs?: string[]; metadata?: any }> }>(
      "/api/vector/search",
      { method: "POST", body: JSON.stringify(body) }
    ),
  doc: (uploadId: string) => api(`/api/vector/doc/${encodeURIComponent(uploadId)}`),
  context: (id: string) => api(`/api/vector/context/${encodeURIComponent(id)}`),
};

export const HybridRAGAPI = {
  retrieve: (body: { query: string; topK?: number; projectId?: string; docType?: string; withAnswer?: boolean; threadId?: string | null }) =>
    api<{ answer: string | null; documents: HybridDocumentResult[]; results: HybridDocumentResult[]; chunks: HybridChunkResult[]; metadata?: any }>(
      "/api/hybrid-rag/retrieve",
      { method: "POST", body: JSON.stringify(body) }
    ),
  search: (body: { query: string; topK?: number; projectId?: string; docType?: string; threadId?: string | null }) =>
    api<{ answer: string | null; documents: HybridDocumentResult[]; results: HybridDocumentResult[]; chunks: HybridChunkResult[]; metadata?: any }>(
      "/api/hybrid-rag/search",
      { method: "POST", body: JSON.stringify(body) }
    ),
};

export const ResearchAPI = {
  ask: (body: { question: string; k?: number; strictCitations?: boolean; projectId?: string; threadId?: string }) =>
    api<{ answer: string; sources: Array<{ id?: string; cite: string; span?: string }> }>("/api/research/ask", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

export const ProjectsAPI = {
  list: () => api<{ items: { id: string; name: string; description?: string | null }[] }>("/api/projects"),
  create: (name: string) => api<{ id: string; name: string }>("/api/projects", { method: "POST", body: JSON.stringify({ name }) }),
  rename: (id: string, name: string) => api<{ ok: true }>(`/api/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  delete: (id: string) => api<{ ok: true }>(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const ThreadsAPI = {
  list: (projectId: string) =>
    api<{ items: { id: string; projectId: string; title: string; status?: string }[] }>(`/api/threads?projectId=${encodeURIComponent(projectId)}`),
  create: (projectId: string, title: string) => api<{ id: string }>("/api/threads", { method: "POST", body: JSON.stringify({ projectId, title }) }),
  rename: (id: string, title: string) => api<{ ok: true }>(`/api/threads/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  delete: (id: string) => api<{ ok: true }>(`/api/threads/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const UploadsAPI = {
  list: (projectId: string) =>
    api<{ items: { id: string; projectId: string; threadId: string | null; name: string; size: number; path: string; indexed: number; status: string; createdAt: string }[] }>(
      `/api/uploads?projectId=${encodeURIComponent(projectId)}`
    ),
  uploadFile: async ({ projectId, threadId, file }: { projectId: string; threadId?: string | null; file: File }) => {
    const form = new FormData();
    form.append("projectId", projectId);
    if (threadId) form.append("threadId", threadId);
    form.append("file", file);
    const headers: HeadersInit = AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {};
    const res = await fetch(`${API_BASE_URL}/api/uploads`, { method: "POST", headers, body: form });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, error: errText || `HTTP ${res.status}`, status: res.status } as ApiErr;
    }
    return {
      ok: true,
      data: (await res.json()) as { id: string; path: string; indexed: number; status: string },
    } as ApiOk<{ id: string; path: string; indexed: number; status: string }>;
  },
  delete: (uploadId: string) =>
    api<{ ok: true }>(`/api/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" }),
  ingest: (uploadId: string, options?: Record<string, any>) =>
    api<{ jobId: string; status: string }>(`/api/uploads/${encodeURIComponent(uploadId)}/ingest`, {
      method: "POST",
      body: JSON.stringify({ options }),
    }),
  jobs: (uploadId: string) =>
    api<{ items: Array<{ id: string; stage: string; status: string; detail: any; startedAt?: string; completedAt?: string }> }>(
      `/api/uploads/${encodeURIComponent(uploadId)}/jobs`
    ),
  markIndexed: (uploadId: string) => api<{ ok: true }>(`/api/uploads/${encodeURIComponent(uploadId)}/indexed`, { method: "POST" }),
};

export const AdminAPI = {
  ingestionJobs: () => api<{ items: AdminIngestionJob[] }>(`/api/admin/ingestion-jobs`),
  ingestionJob: (jobId: string) =>
    api<{ job: AdminIngestionJob }>(`/api/admin/ingestion/${encodeURIComponent(jobId)}`),
  ingestionChunks: (jobId: string, params?: { limit?: number; offset?: number }) => {
    const search = new URLSearchParams();
    if (params?.limit !== undefined) {
      search.set("limit", String(params.limit));
    }
    if (params?.offset !== undefined) {
      search.set("offset", String(params.offset));
    }
    const qs = search.toString();
    const url = `/api/admin/ingestion/${encodeURIComponent(jobId)}/chunks${qs ? `?${qs}` : ""}`;
    return api<AdminChunksResponse>(url);
  },
  ingestionKg: (jobId: string) =>
    api<AdminKgResponse>(`/api/admin/ingestion/${encodeURIComponent(jobId)}/kg`),
};

export const BriefAPI = {
  list: (projectId?: string) => {
    const qp = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    return api<{ items: Array<{ id: string; projectId: string; threadId: string | null; title: string; cite?: string | null; note?: string | null; createdAt: string }> }>(
      `/api/brief${qp}`
    );
  },
  add: (projectId: string, title: string, refId?: string, note?: string) =>
    api<{ id: string }>("/api/brief", {
      method: "POST",
      body: JSON.stringify({ projectId, title, cite: refId, note }),
    }),
  delete: (id: string) => api<{ ok: true }>(`/api/brief/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const MessagesAPI = {
  list: (threadId: string) =>
    api<{ items: { id: string; role: "user" | "assistant"; content: string; createdAt: string }[] }>(
      `/api/messages?threadId=${encodeURIComponent(threadId)}`
    ),
  add: (payload: { threadId: string; role: "user" | "assistant"; content: string }) =>
    api<{ id: string }>("/api/messages", { method: "POST", body: JSON.stringify(payload) }),
  addBatch: (threadId: string, items: { role: "user" | "assistant"; content: string }[]) =>
    api<{ ok: true }>("/api/messages/batch", { method: "POST", body: JSON.stringify({ threadId, items }) }),
  delete: (id: string) => api<{ ok: true }>(`/api/messages/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const ResearchAttentionAPI = {
  list: (projectId?: string) => {
    const qp = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    return api<{ items: Array<{ id: string; message: string; severity?: "info" | "warn" | "error" }> }>(
      `/api/research/needs-attention${qp}`
    );
  },
  add: (body: { projectId: string; message: string; severity?: "info" | "warn" | "error" }) =>
    api<{ id: string }>("/api/research/needs-attention", { method: "POST", body: JSON.stringify(body) }),
  resolve: (id: string) =>
    api<{ ok: true }>(`/api/research/needs-attention/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const ComplianceAPI = {
  status: () => api<{ statuses: any[]; updates: any[]; audit: any[] }>("/api/compliance/status"),
};

export const ContractsAPI = {
  review: (body: { text?: string; url?: string }) =>
    api<{
      risk_score: number;
      clauses: Array<{ name: string; risk: "High" | "Medium" | "Low"; recommendation: string }>;
      obligations: Array<{ title: string; due: string; status: string }>;
      redlines: string;
      compliance: Array<{ name: string; status: "OK" | "Review" | "Fail" }>;
    }>("/api/contracts/review", { method: "POST", body: JSON.stringify(body) }),
};

export const DraftingAPI = {
  generate: (body: { prompt: string; template?: string; jurisdiction?: string }) =>
    api<{ draft_text: string; versionId: string }>("/api/drafting/generate", { method: "POST", body: JSON.stringify(body) }),
};

export const LitigationAPI = {
  insights: (body: { matter: string }) =>
    api<{
      strategies: Array<{ title: string; text: string; confidence: string; cites?: string }>;
      timeline: Array<{ label: string; date: string; status: string }>;
      authorities: Array<{ title: string; cite: string; summary: string }>;
    }>("/api/litigation/insights", { method: "POST", body: JSON.stringify(body) }),
};




