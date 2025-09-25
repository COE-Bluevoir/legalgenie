import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Scale,
  History as HistoryIcon,
  UploadCloud,
  MessageSquare,
  FileText,
  Loader2,
  AlertTriangle,
  Sparkles,
  Paperclip,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  RefreshCw,
  Clock
} from "lucide-react";
import { createPortal } from "react-dom";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

import {
  useApiAction,
  ProjectsAPI,
  ThreadsAPI,
  UploadsAPI,
  MessagesAPI,
  HybridRAGAPI,
  BriefAPI,
  ResearchAttentionAPI,
} from "@/lib/api";
import type { HybridDocumentResult, HybridChunkResult } from "@/lib/api";

import ResultRow from "./ResultRow";

type Project = { id: string; name: string };
type Thread = { id: string; projectId: string; title: string };
type UploadItem = { id: string; name: string; size: number; projectId: string; createdAt?: string | null };
type ConversationMessage = { id: string; role: "user" | "assistant"; content: string; createdAt?: string | null };
type SearchResult = {
  id?: string;
  docId?: string;
  docKey?: string | null;
  title: string;
  snippet: string;
  relevance: number;
  similarity?: number;
  chunkCount?: number;
  chunkIds?: string[];
  court?: string;
  judge?: string;
  date?: string;
  langs?: string[];
  citation?: string | null;
  citations?: string[];
  docType?: string | null;
  path?: string | null;
  uploadId?: string | null;
  metadata?: Record<string, unknown> | null;
  chunks?: HybridChunkResult[] | null;
  source?: HybridDocumentResult;
};
type BriefItem = { id: string; projectId: string; threadId?: string | null; title: string; cite?: string | null; note?: string | null; createdAt?: string | null };
type AttentionItem = { id: string; message: string; severity?: "info" | "warn" | "error" };
type CitationItem = { id?: string; cite?: string; title?: string; span?: string };
type HistoryEntry = { id: string; kind: "search" | "ask"; label: string; createdAt: string; docCount?: number; documents?: SearchResult[] };

type ModalKind =
  | { type: "create-project" }
  | { type: "rename-project"; id: string }
  | { type: "delete-project"; id: string }
  | { type: "create-thread"; projectId: string }
  | { type: "delete-thread"; id: string; projectId: string }
  | { type: "delete-upload"; id: string };

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

const STREAM_INTERVAL_MS = 18;

// ---------- Debug toggles ----------
const DEBUG = true;
const USE_RAW_FETCH_DEBUG = false;
// -----------------------------------

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  const decimals = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[index]}`;
};

const formatDate = (value?: string | null) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
};

const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, footer }) => {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[200]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">{title}</div>
          <Button variant="ghost" size="sm" className="rounded-md" onClick={onClose}>
            Esc
          </Button>
        </div>
        <div>{children}</div>
        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body
  );
};

const ResearchEngine: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [briefItems, setBriefItems] = useState<BriefItem[]>([]);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [citations, setCitations] = useState<CitationItem[]>([]);
  const [searchHistory, setSearchHistory] = useState<HistoryEntry[]>([]);

  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const [activeThreadId, setActiveThreadId] = useState<string>("");

  const [query, setQuery] = useState("");
  const [composer, setComposer] = useState("");
  const [docType, setDocType] = useState<string>("");  const [onlyCitations] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [answerStreamingId, setAnswerStreamingId] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalKind | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingThreadTitle, setEditingThreadTitle] = useState("");
  const [showUtilities, setShowUtilities] = useState(true);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  // Always jump to the newest message (and while streaming).
useEffect(() => {
  chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
}, [messages.length, answerStreamingId]);
  const { execute: executeSearch, loading: searching, error: searchError } = useApiAction(HybridRAGAPI.search);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId]
  );

  const pushHistory = useCallback(
    (kind: HistoryEntry["kind"], label: string, docs?: SearchResult[]) => {
      const trimmed = label.trim();
      if (!trimmed) return;
      setSearchHistory((prev) => {
        const existing = prev.find(
          (item) => item.kind === kind && item.label.toLowerCase() === trimmed.toLowerCase()
        );
        const filtered = prev.filter(
          (item) => !(item.kind === kind && item.label.toLowerCase() === trimmed.toLowerCase())
        );
        const resolvedDocs = docs && docs.length
          ? docs
          : existing?.documents && existing.documents.length
            ? existing.documents
            : undefined;
        const entry: HistoryEntry = {
          id: `${kind}-${Date.now().toString(36)}`,
          kind,
          label: trimmed,
          createdAt: new Date().toISOString(),
          docCount: resolvedDocs?.length ? resolvedDocs.length : undefined,
          documents: resolvedDocs,
        };
        return [entry, ...filtered].slice(0, 20);
      });
    },
    []
  );

  const loadProjects = useCallback(async () => {
    const res = await ProjectsAPI.list();
    if (!res.ok) {
      setProjects([]);
      if (DEBUG) console.log("[ResearchEngine] loadProjects failed:", res.error);
      return;
    }
    const raw = res.data as any;
    const list = raw?.items ?? raw?.projects ?? (Array.isArray(raw) ? raw : []);
    const normalized: Project[] = (Array.isArray(list) ? list : [])
      .filter((item: any) => item?.id)
      .map((item: any) => ({ id: String(item.id), name: item.name ?? "Untitled Project" }));
    if (DEBUG) console.log("[ResearchEngine] loadProjects ok:", normalized);
    setProjects(normalized);
  }, []);

  const loadThreads = useCallback(async (projectId: string) => {
    const res = await ThreadsAPI.list(projectId);
    if (!res.ok) {
      setThreads([]);
      if (DEBUG) console.log("[ResearchEngine] loadThreads failed:", res.error);
      return;
    }
    const raw = res.data as any;
    const list = raw?.items ?? raw?.threads ?? (Array.isArray(raw) ? raw : []);
    const normalized: Thread[] = (Array.isArray(list) ? list : [])
      .filter((item: any) => item?.id)
      .map((item: any) => ({
        id: String(item.id),
        projectId: String(item.project_id ?? item.projectId ?? projectId),
        title: item.title ?? "Untitled Thread",
      }));
    if (DEBUG) console.log("[ResearchEngine] loadThreads ok:", normalized);
    setThreads(normalized);
  }, []);

  const loadUploads = useCallback(async (projectId: string) => {
    const res = await UploadsAPI.list(projectId);
    if (!res.ok) {
      setUploads([]);
      if (DEBUG) console.log("[ResearchEngine] loadUploads failed:", res.error);
      return;
    }
    const raw = res.data as any;
    const list = raw?.items ?? raw?.files ?? (Array.isArray(raw) ? raw : []);
    const normalized: UploadItem[] = (Array.isArray(list) ? list : [])
      .filter((item: any) => item?.id)
      .map((item: any) => ({
        id: String(item.id),
        name: item.name ?? "Untitled document",
        size: Number(item.size ?? 0),
        projectId: String(item.project_id ?? item.projectId ?? projectId),
        createdAt: item.createdAt ?? item.created_at ?? null,
      }));
    if (DEBUG) console.log("[ResearchEngine] loadUploads ok:", normalized);
    setUploads(normalized);
  }, []);

  const loadBrief = useCallback(async (projectId: string) => {
    if (!projectId) {
      setBriefItems([]);
      return;
    }
    const res = await BriefAPI.list(projectId);
    if (!res.ok) {
      setBriefItems([]);
      if (DEBUG) console.log("[ResearchEngine] loadBrief failed:", res.error);
      return;
    }
    const raw = res.data as any;
    const list = raw?.items ?? (Array.isArray(raw) ? raw : []);
    const normalized: BriefItem[] = (Array.isArray(list) ? list : [])
      .filter((item: any) => item?.id)
      .map((item: any) => ({
        id: String(item.id),
        projectId: String(item.projectId ?? item.project_id ?? projectId),
        threadId: item.threadId ?? item.thread_id ?? null,
        title: item.title ?? "Untitled note",
        cite: item.cite ?? null,
        note: item.note ?? null,
        createdAt: item.createdAt ?? item.created_at ?? null,
      }));
    if (DEBUG) console.log("[ResearchEngine] loadBrief ok:", normalized);
    setBriefItems(normalized);
  }, []);

  const loadAttention = useCallback(async (projectId: string) => {
    if (!projectId) {
      setAttentionItems([]);
      return;
    }
    const res = await ResearchAttentionAPI.list(projectId);
    if (!res.ok) {
      setAttentionItems([]);
      if (DEBUG) console.log("[ResearchEngine] loadAttention failed:", res.error);
      return;
    }
    const raw = res.data as any;
    const list = raw?.items ?? (Array.isArray(raw) ? raw : []);
    const normalized: AttentionItem[] = (Array.isArray(list) ? list : [])
      .filter((item: any) => item?.message)
      .map((item: any, index: number) => ({
        id: item.id ? String(item.id) : `local-${index}`,
        message: item.message ?? "Needs attention",
        severity: item.severity ?? "info",
      }));
    if (DEBUG) console.log("[ResearchEngine] loadAttention ok:", normalized);
    setAttentionItems(normalized);
  }, []);

  const loadMessages = useCallback(async (threadId: string) => {
    const res = await MessagesAPI.list(threadId);
    if (!res.ok) {
      setMessages([]);
      if (DEBUG) console.log("[ResearchEngine] loadMessages failed:", res.error);
      return;
    }
    const raw = res.data as any;
    const list = raw?.items ?? (Array.isArray(raw) ? raw : []);
    const normalized: ConversationMessage[] = (Array.isArray(list) ? list : [])
      .filter((item: any) => item?.id)
      .map((item: any) => ({
        id: String(item.id),
        role: item.role === "assistant" ? "assistant" : "user",
        content: item.content ?? "",
        createdAt: item.createdAt ?? item.created_at ?? null,
      }));
    if (DEBUG) console.log("[ResearchEngine] loadMessages ok:", normalized);
    setMessages(normalized);
  }, []);

  useEffect(() => { if (DEBUG) console.log("[ResearchEngine] mount: loading projects"); loadProjects(); }, [loadProjects]);

  useEffect(() => {
    if (DEBUG) console.log("[ResearchEngine] projects changed:", projects);
    if (!projects.length) { if (activeProjectId) setActiveProjectId(""); return; }
    if (!activeProjectId || !projects.some((p) => p.id === activeProjectId)) setActiveProjectId(projects[0].id);
  }, [projects, activeProjectId]);

  useEffect(() => {
    if (DEBUG) console.log("[ResearchEngine] activeProjectId:", activeProjectId);
    if (!activeProjectId) {
      setThreads([]); setActiveThreadId(""); setUploads([]); setMessages([]); setBriefItems([]); setAttentionItems([]); setCitations([]);
      return;
    }
    loadThreads(activeProjectId); loadUploads(activeProjectId); loadBrief(activeProjectId); loadAttention(activeProjectId);
  }, [activeProjectId, loadThreads, loadUploads, loadBrief, loadAttention]);

  useEffect(() => {
    if (DEBUG) console.log("[ResearchEngine] threads changed:", threads);
    if (!threads.length) { if (activeThreadId) setActiveThreadId(""); return; }
    if (!activeThreadId || !threads.some((t) => t.id === activeThreadId)) setActiveThreadId(threads[0].id);
  }, [threads, activeThreadId]);

  useEffect(() => {
    if (DEBUG) console.log("[ResearchEngine] activeThreadId:", activeThreadId);
    if (!activeThreadId) { setMessages([]); return; }
    loadMessages(activeThreadId);
  }, [activeThreadId, loadMessages]);

  const streamAnswer = useCallback((messageId: string, answer: string) => {
    return new Promise<void>((resolve) => {
      setAnswerStreamingId(messageId);
      const tokens = Array.from(answer);
      let index = 0;
      const tick = () => {
        index = Math.min(tokens.length, index + 3);
        const next = tokens.slice(0, index).join("");
        setMessages((prev) => prev.map((msg) => (msg.id === messageId ? { ...msg, content: next } : msg)));
        if (index >= tokens.length) { setAnswerStreamingId(null); resolve(); return; }
        window.setTimeout(tick, STREAM_INTERVAL_MS);
      };
      tick();
    });
  }, []);

  const mapDocumentsToResults = useCallback(
    (docs: HybridDocumentResult[]): SearchResult[] =>
      docs.map((doc, index) => {
        const metadata = doc.metadata && typeof doc.metadata === "object" ? (doc.metadata as Record<string, unknown>) : undefined;
        const metadataDocType = metadata?.["docType"];
        const metadataDocTypeAlt = metadata?.["doc_type"];
        const docTypeValue =
          typeof doc.docType === "string"
            ? doc.docType
            : typeof metadataDocType === "string"
              ? (metadataDocType as string)
              : typeof metadataDocTypeAlt === "string"
                ? (metadataDocTypeAlt as string)
                : undefined;

        const metadataPath = metadata?.["path"];
        const metadataSourcePathRelative = metadata?.["source_path_relative"];
        const metadataSourcePath = metadata?.["source_path"];
        const pathValue =
          typeof doc.path === "string"
            ? doc.path
            : typeof metadataPath === "string"
              ? (metadataPath as string)
              : typeof metadataSourcePathRelative === "string"
                ? (metadataSourcePathRelative as string)
                : typeof metadataSourcePath === "string"
                  ? (metadataSourcePath as string)
                  : null;

        const metadataUpload = metadata?.["uploadId"] ?? metadata?.["upload_id"];
        const uploadValue = typeof doc.uploadId === "string"
          ? doc.uploadId
          : typeof metadataUpload === "string"
            ? (metadataUpload as string)
            : undefined;

        const metadataCitationsRaw = metadata && Array.isArray(metadata["citations"])
          ? (metadata["citations"] as unknown[])
          : [];
        const metadataCitations = metadataCitationsRaw.filter((value): value is string => typeof value === "string");
        const docCitations = Array.isArray(doc.citations)
          ? doc.citations.filter((value): value is string => typeof value === "string")
          : [];
        const citations = docCitations.length ? docCitations : metadataCitations;

        const chunkCount = typeof doc.chunkCount === "number"
          ? doc.chunkCount
          : Array.isArray(doc.chunks)
            ? doc.chunks.length
            : 0;
        const chunkIds = Array.isArray(doc.chunkIds)
          ? doc.chunkIds.map((value) => String(value))
          : undefined;

        const relevanceScore = typeof doc.score === "number"
          ? doc.score
          : typeof doc.similarity === "number"
            ? Math.round(Math.max(0, Math.min(1, doc.similarity)) * 1000) / 10
            : 0;

        return {
          id: doc.id ? String(doc.id) : String(index),
          docId: doc.id ? String(doc.id) : undefined,
          docKey: doc.docKey ?? (doc.id ? String(doc.id) : undefined),
          title: doc.title ?? "Untitled document",
          snippet: doc.snippet ?? "",
          relevance: relevanceScore,
          similarity: typeof doc.similarity === "number" ? doc.similarity : undefined,
          chunkCount,
          chunkIds,
          court: doc.court,
          judge: doc.judge,
          date: doc.date,
          langs: Array.isArray(doc.langs) ? doc.langs : undefined,
          citation: doc.citation ?? (citations.length ? citations[0] : null),
          citations: citations.length ? citations : undefined,
          docType: docTypeValue ?? undefined,
          path: pathValue ?? undefined,
          uploadId: uploadValue ?? undefined,
          metadata: metadata ?? null,
          chunks: Array.isArray(doc.chunks) ? doc.chunks : null,
          source: doc,
        } as SearchResult;
      }),
    []
  );
  const onSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed || !activeProjectId) return;
    if (DEBUG) console.log("[Search] fired", { trimmed, activeProjectId, docType, activeThreadId });

    const payload: Record<string, unknown> = { query: trimmed, topK: 20, projectId: activeProjectId };
    if (docType) payload.docType = docType;
    if (activeThreadId) payload.threadId = activeThreadId;

    const res = await executeSearch(payload as any);
    if (DEBUG) console.log("[Search] API result:", res);

    if (res.ok) {
      const documents = (res.data?.documents ?? res.data?.results ?? []) as HybridDocumentResult[];
      const mapped = mapDocumentsToResults(documents);
      const filtered = mapped.filter((item) => {
        const matchesDoc = !docType || !item.docType || item.docType === docType;
        const matchesCitation = !onlyCitations || (Array.isArray(item.citations) && item.citations.length > 0);
        return matchesDoc && matchesCitation;
      });
      if (DEBUG) console.log("[Search] mapped results:", filtered);
      setResults(filtered);
      if (!onlyCitations) setCitations([]);
      pushHistory("search", trimmed, filtered);
    }
  }, [executeSearch, query, docType, onlyCitations, activeProjectId, activeThreadId, mapDocumentsToResults, pushHistory]);

  const onAsk = useCallback(async () => {
    const question = (composer || query).trim();
    if (DEBUG) console.log("[Ask] fired", { question, activeProjectId, activeThreadId });
    if (!question || !activeProjectId || !activeThreadId) { if (DEBUG) console.log("[Ask] early-return guard hit"); return; }

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const userMessage: ConversationMessage = { id: `user-${stamp}`, role: "user", content: question, createdAt: new Date().toISOString() };
    const assistantMessage: ConversationMessage = { id: `assistant-${stamp}`, role: "assistant", content: "", createdAt: new Date().toISOString() };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setComposer("");
    setIsGenerating(true);

    try { await MessagesAPI.add({ threadId: activeThreadId, role: "user", content: question }).catch(() => {}); } catch {}

    try {
      if (USE_RAW_FETCH_DEBUG) {
        const base = (window as any).VITE_API_BASE || (import.meta as any)?.env?.VITE_API_BASE || "http://localhost:8787";
        const url = `${String(base).replace(/\/$/, "")}/api/hybrid-rag/retrieve`;
        console.log("[Ask][RAW] fetch ", url);
        const raw = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(localStorage.getItem("lg_token") ? { Authorization: `Bearer ${localStorage.getItem("lg_token")}` } : {}) },
          body: JSON.stringify({ query: question, projectId: activeProjectId, threadId: activeThreadId, withAnswer: true, topK: 8 }),
        });
        console.log("[Ask][RAW] status", raw.status);
        try { console.log("[Ask][RAW] json", await raw.clone().json()); } catch { console.log("[Ask][RAW] text", await raw.text()); }
      }

      console.log("[Ask] calling HybridRAGAPI.retrieve");
      const response = await HybridRAGAPI.retrieve({ query: question, projectId: activeProjectId, threadId: activeThreadId, withAnswer: true, topK: 8 });
      console.log("[Ask] retrieve response", response);
      if (!response.ok) throw new Error(response.error);

      const answer = response.data.answer ?? "No direct answer available. Please review the retrieved materials.";

      const documents = (response.data.results ?? response.data.documents ?? []) as HybridDocumentResult[];
      const mappedResults = mapDocumentsToResults(documents);
      if (DEBUG) console.log("[Ask] mapped results:", mappedResults);
      setResults(mappedResults);

      const metadataSourcesRaw = ((response.data as any)?.metadata?.citations ?? (response.data as any)?.sources ?? []) as any[];
      const metadataCitations = Array.isArray(metadataSourcesRaw)
        ? metadataSourcesRaw
            .filter((item) => item)
            .map((item, index) => ({
              id: item?.id ? String(item.id) : `meta-${index}`,
              cite: item?.cite ?? item?.span ?? undefined,
              title: item?.title ?? item?.source ?? undefined,
              span: item?.span ?? undefined,
            }))
        : [];
      const docCitations = mappedResults.flatMap((doc, docIndex) => {
        const cites = doc.citations && doc.citations.length ? doc.citations : doc.citation ? [doc.citation] : [];
        return cites.map((cite, citeIndex) => ({
          id: doc.id ? `${doc.id}-${citeIndex}` : `doc-${docIndex}-${citeIndex}`,
          cite,
          title: doc.title,
          span: doc.snippet,
        }));
      });

      if (metadataCitations.length) {
        if (DEBUG) console.log("[Ask] metadata citations:", metadataCitations);
        setCitations(metadataCitations);
      } else if (docCitations.length) {
        const limited = docCitations.slice(0, 10);
        if (DEBUG) console.log("[Ask] doc-derived citations:", limited);
        setCitations(limited);
      } else if (mappedResults.length) {
        const fallback = mappedResults.slice(0, 6).map((item, index) => ({
          id: item.id ?? `fallback-${index}`,
          cite: item.title,
          title: item.snippet,
        }));
        if (DEBUG) console.log("[Ask] fallback citations:", fallback);
        setCitations(fallback);
      }

      await streamAnswer(assistantMessage.id, answer);
      try { await MessagesAPI.add({ threadId: activeThreadId, role: "assistant", content: answer }).catch(() => {}); } catch {}
      pushHistory("ask", question, mappedResults);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to generate an answer right now.";
      console.error("[Ask] error:", err);
      await streamAnswer(assistantMessage.id, message);
      pushHistory("ask", question);
    } finally {
      setIsGenerating(false);
    }
  }, [composer, query, activeProjectId, activeThreadId, streamAnswer, mapDocumentsToResults, pushHistory]);


  const onFilesSelected = useCallback(
    async (files: FileList | null) => {
      if (!files || !files.length || !activeProjectId) return;
      const selection = Array.from(files);
      if (DEBUG) console.log("[Uploads] selected:", selection.map(f => ({ name: f.name, size: f.size })));
      for (const file of selection) {
        try { await UploadsAPI.uploadFile({ projectId: activeProjectId, threadId: activeThreadId || undefined, file }); }
        catch (err) { console.error("[Uploads] upload error:", err); }
      }
      await loadUploads(activeProjectId);
    },
    [activeProjectId, activeThreadId, loadUploads]
  );

  const startRenameThread = useCallback((thread: Thread) => { setEditingThreadId(thread.id); setEditingThreadTitle(thread.title); }, []);
  const cancelRenameThread = useCallback(() => { setEditingThreadId(null); setEditingThreadTitle(""); }, []);
  const commitRenameThread = useCallback(async () => {
    if (!editingThreadId) return;
    const trimmed = editingThreadTitle.trim();
    if (!trimmed) { cancelRenameThread(); return; }
    await ThreadsAPI.rename(editingThreadId, trimmed).catch(() => {});
    setThreads((prev) => prev.map((t) => (t.id === editingThreadId ? { ...t, title: trimmed } : t)));
    cancelRenameThread();
    if (activeProjectId) await loadThreads(activeProjectId);
  }, [editingThreadId, editingThreadTitle, activeProjectId, loadThreads, cancelRenameThread]);

  const handleModalConfirm = useCallback(async () => {
    if (!modal) return;
    setModalError(null);
    try {
      if (modal.type === "create-project") {
        const value = nameInput.trim(); if (!value) { setModalError("Project name is required."); return; }
        const res = await ProjectsAPI.create(value); if (!res.ok) throw new Error(res.error);
        await loadProjects(); if (res.data?.id) setActiveProjectId(String(res.data.id));
      } else if (modal.type === "rename-project") {
        const value = nameInput.trim(); if (!value) { setModalError("Project name is required."); return; }
        const res = await ProjectsAPI.rename(modal.id, value); if (!res.ok) throw new Error(res.error);
        await loadProjects();
      } else if (modal.type === "delete-project") {
        const res = await ProjectsAPI.delete(modal.id); if (!res.ok) throw new Error(res.error);
        await loadProjects();
      } else if (modal.type === "create-thread") {
        const value = nameInput.trim(); if (!value) { setModalError("Thread name is required."); return; }
        const res = await ThreadsAPI.create(modal.projectId, value); if (!res.ok) throw new Error(res.error);
        await loadThreads(modal.projectId); if (res.data?.id) setActiveThreadId(String(res.data.id));
      } else if (modal.type === "delete-thread") {
        const res = await ThreadsAPI.delete(modal.id); if (!res.ok) throw new Error(res.error);
        await loadThreads(modal.projectId);
      } else if (modal.type === "delete-upload") {
        const res = await UploadsAPI.delete(modal.id); if (!res.ok) throw new Error(res.error);
        if (activeProjectId) await loadUploads(activeProjectId);
      }
      setModal(null); setNameInput(""); setModalError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setModalError(message);
    }
  }, [modal, nameInput, activeProjectId, loadProjects, loadThreads, loadUploads]);

  const renderModal = () => {
    if (!modal) return null;
    let title = ""; let description: string | null = null; let confirmLabel = "Save"; let showInput = false;
    if (modal.type === "create-project") { title = "Create project"; description = "Name your new research project."; confirmLabel = "Create"; showInput = true; }
    else if (modal.type === "rename-project") { title = "Rename project"; description = "Update the project name."; confirmLabel = "Save"; showInput = true; }
    else if (modal.type === "delete-project") { title = "Delete project"; description = "This will remove the project, its threads, and associated data."; confirmLabel = "Delete"; }
    else if (modal.type === "create-thread") { title = "Create thread"; description = "Start a new research conversation in this project."; confirmLabel = "Create"; showInput = true; }
    else if (modal.type === "delete-thread") { title = "Delete thread"; description = "This will remove the selected thread and its messages."; confirmLabel = "Delete"; }
    else if (modal.type === "delete-upload") {
      title = "Delete upload";
      const file = uploads.find((item) => item.id === (modal as any).id);
      description = file ? `Remove "${file.name}" from the workspace? The underlying file will be deleted.` : "Remove this file from the workspace?";
      confirmLabel = "Delete";
    }

    return (
      <Modal
        open
        title={title}
        onClose={() => { setModal(null); setModalError(null); }}
        footer={
          <>
            <Button variant="outline" onClick={() => { setModal(null); setModalError(null); }}>Cancel</Button>
            <Button onClick={handleModalConfirm}>{confirmLabel}</Button>
          </>
        }
      >
        <div className="space-y-3">
          {description && (<p className="text-sm text-neutral-600 dark:text-neutral-300">{description}</p>)}
          {showInput && (
            <Input
              autoFocus
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") handleModalConfirm(); if (event.key === "Escape") { setModal(null); setModalError(null); } }}
              placeholder="Type a name"
            />
          )}
          {modalError && <div className="text-sm text-red-600">{modalError}</div>}
        </div>
      </Modal>
    );
  };

  const mainColumnClass = showUtilities ? "lg:col-span-6" : "lg:col-span-9";
  const severityTone: Record<"info" | "warn" | "error", string> = {
    info: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/60 dark:bg-blue-950/40 dark:text-blue-200",
    warn: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200",
    error: "border-red-200 bg-red-50 text-red-700 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200",
  };

  return (
    <>
      <div className="flex h-full min-h-0 w-full flex-col overflow-auto rounded-2xl bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <div className="sticky top-0 z-10 border-b border-neutral-200/70 bg-white/80 px-4 py-3 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-900/80">
          {/* header bar unchanged */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-slate-600" />
              <span className="font-semibold tracking-tight">Research</span>
              {activeProject && (
                <Badge variant="secondary" className="rounded-full text-xs">
                  Active: {activeProject.name}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="min-w-[180px] rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                value={activeProjectId}
                onChange={(event) => setActiveProjectId(event.target.value)}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setNameInput(`Project ${projects.length + 1}`); setModal({ type: "create-project" }); setModalError(null); }}
              >
                <Plus className="mr-1 h-4 w-4" /> New Project
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!activeProjectId}
                onClick={() => {
                  const current = projects.find((item) => item.id === activeProjectId);
                  setNameInput(current?.name ?? "");
                  setModal({ type: "rename-project", id: activeProjectId });
                  setModalError(null);
                }}
              >
                Rename
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                disabled={!activeProjectId || projects.length <= 1}
                onClick={() => { if (activeProjectId) { setModal({ type: "delete-project", id: activeProjectId }); setModalError(null); } }}
              >
                Delete
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowUtilities((prev) => !prev)}>
                {showUtilities ? "Hide panels" : "Show panels"}
              </Button>
            </div>
          </div>
        </div>

        {/* MAIN BODY */}
        <div className="flex-1 min-h-0 overflow-hidden px-4 py-4">
          <div className="grid h-full min-h-0 gap-4 lg:grid-cols-12">
            {/* LEFT */}
            <aside className="lg:col-span-3 min-h-0">
              <div className="flex h-full min-h-0 flex-col gap-4 pr-1">
                {/* Search workspace (unchanged) */}
                <Card className="border-neutral-200/70 dark:border-neutral-800/70">
                  <CardHeader className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Search className="h-4 w-4" />
                      Search workspace
                    </div>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Query your project corpus and external sources.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search judgments, orders, statutes..."
                      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onSearch(); } }}
                    />
                    <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-600 dark:text-neutral-400">
                      <label className="flex items-center gap-2">
                        <span className="whitespace-nowrap">Document type:</span>
                        <select
                          className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                          value={docType}
                          onChange={(event) => setDocType(event.target.value)}
                        >
                          <option value="">All</option>
                          <option value="judgment">Judgment</option>
                          <option value="order">Order</option>
                          <option value="statute">Statute</option>
                        </select>
                      </label>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={onSearch} disabled={searching || !activeProjectId || !query.trim()} className="rounded-md">
                          {searching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                          Search
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => { setQuery(""); setResults([]); setCitations([]); }}>
                          Clear
                        </Button>
                      </div>
                    </div>
                    {searchError && (
                      <div className="flex items-center gap-2 text-sm text-red-600">
                        <AlertTriangle className="h-4 w-4" /> {searchError}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Threads */}
                <Card className="border-neutral-200/70 dark:border-neutral-800/70">
                  <CardHeader className="flex flex-row items-center justify-between gap-2 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <HistoryIcon className="h-4 w-4" /> Threads
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      className="rounded-md"
                      onClick={() => {
                        if (!activeProjectId) return;
                        setNameInput(`Thread ${threads.length + 1}`);
                        setModal({ type: "create-thread", projectId: activeProjectId });
                        setModalError(null);
                      }}
                      disabled={!activeProjectId}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4 pt-0">
                    <div className="space-y-2 overflow-auto pr-1">
                      {threads.map((thread) => {
                        const isActive = thread.id === activeThreadId;
                        return (
                          <div
                            key={thread.id}
                            className={`rounded-md border px-3 py-2 text-sm transition ${
                              isActive
                                ? "border-slate-500 bg-slate-100 text-slate-900 dark:border-slate-500/60 dark:bg-slate-900"
                                : "border-neutral-200 hover:border-slate-400 hover:bg-slate-100 dark:border-neutral-800 dark:hover:border-slate-500 dark:hover:bg-slate-900/40"
                            }`}
                          >
                            {editingThreadId === thread.id ? (
                              <div className="flex items-center gap-2">
                                <Input
                                  value={editingThreadTitle}
                                  onChange={(event) => setEditingThreadTitle(event.target.value)}
                                  autoFocus
                                  onKeyDown={(event) => { if (event.key === "Enter") commitRenameThread(); if (event.key === "Escape") cancelRenameThread(); }}
                                />
                                <Button variant="ghost" size="icon" onClick={commitRenameThread}><Check className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" onClick={cancelRenameThread}><X className="h-4 w-4" /></Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <button type="button" onClick={() => setActiveThreadId(thread.id)} className="flex-1 text-left">
                                  <div className="truncate" title={thread.title}>{thread.title}</div>
                                  {isActive && (<div className="text-xs text-neutral-500 dark:text-neutral-400">Active conversation</div>)}
                                </button>
                                <Button variant="ghost" size="icon" onClick={() => startRenameThread(thread)}><Edit2 className="h-4 w-4" /></Button>
                                <Button
                                  variant="ghost" size="icon" className="text-red-500"
                                  onClick={() => { setModal({ type: "delete-thread", id: thread.id, projectId: thread.projectId }); setModalError(null); }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {!threads.length && (
                        <div className="rounded-md border border-dashed border-neutral-200 px-3 py-6 text-center text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                          No threads yet. Create one to start collaborating.
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Uploads */}
                <Card className="border-neutral-200/70 dark:border-neutral-800/70">
                  <CardHeader className="flex flex-row items-center justify-between gap-2 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <UploadCloud className="h-4 w-4" /> Uploads
                    </div>
                    <Button variant="outline" size="icon" className="rounded-md" onClick={() => fileInputRef.current?.click()} disabled={!activeProjectId}>
                      <Paperclip className="h-4 w-4" />
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4 pt-0">
                    <div className="space-y-2 overflow-auto pr-1">
                      {uploads.map((file) => (
                        <div key={file.id} className="flex items-start justify-between rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
                          <div className="pr-2">
                            <div className="truncate font-medium">{file.name}</div>
                            <div className="text-xs text-neutral-500 dark:text-neutral-400">
                              {formatBytes(file.size)}{file.createdAt ? ` • ${formatDate(file.createdAt)}` : ""}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="rounded-full text-xs">Stored</Badge>
                            <Button
                              variant="ghost" size="icon" className="text-red-500"
                              onClick={() => { setModal({ type: "delete-upload", id: file.id }); setModalError(null); }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      {!uploads.length && (
                        <div className="rounded-md border border-dashed border-neutral-200 px-3 py-6 text-center text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                          Attach documents to enrich retrieval answers.
                        </div>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        onFilesSelected(event.target.files);
                        if (event.target) event.target.value = "";
                      }}
                    />
                  </CardContent>
                </Card>
              </div>
            </aside>

            {/* CENTER */}
<main className={`${mainColumnClass} min-h-0 flex flex-col overflow-hidden`}>
  {/* Two columns: Search results (left) + Ask Genie (right) */}
  <div className="flex-1 min-h-0 flex gap-4 pr-1 overflow-hidden">
    {/* SEARCH RESULTS */}
    <Card className="flex-1 min-w-0 flex flex-col overflow-hidden border-neutral-200/70 dark:border-neutral-800/70">
      <CardHeader className="flex items-center justify-between text-sm font-medium">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4" /> Search results
        </div>
      </CardHeader>

      {/* Only the list scrolls */}
      <CardContent className="flex-1 min-h-0 overflow-auto p-4 pt-0">
        {searching && (
          <div className="mb-3 flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Gathering relevant materials...
          </div>
        )}
        <div className="space-y-3">
          {results.map((item, index) => (
            <ResultRow
              key={`${item.id ?? "result"}-${index}`}
              idx={index + 1}
              fromApi
              item={{
                relevance: item.relevance,
                title: item.title,
                snippet: item.snippet,
                court: item.court,
                judge: item.judge,
                date: item.date,
                langs: item.langs,
              }}
            />
          ))}
          {!searching && !results.length && (
            <div className="rounded-md border border-dashed border-neutral-200 px-4 py-8 text-center text-sm text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
              Run a search to populate authoritative results.
            </div>
          )}
        </div>
      </CardContent>
    </Card>

    {/* ASK GENIE */}
    <Card className="flex-1 min-w-0 flex flex-col overflow-hidden border-neutral-200/70 dark:border-neutral-800/70">
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-slate-600" /> Ask Genie
        </div>
      </CardHeader>

      {/* Messages scroll; composer pins to bottom */}
      <CardContent className="flex-1 min-h-0 overflow-hidden p-4 pt-0 flex flex-col gap-4">
        {/* Chat window */}
        <div className="flex-1 min-h-0 overflow-auto rounded-md border border-neutral-200 px-3 py-3 dark:border-neutral-800 space-y-3">
          {messages.map((message) => {
            const isUser = message.role === "user";
            const isStreaming = answerStreamingId === message.id;
            return (
              <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[90%] rounded-xl border px-3 py-2 text-sm shadow-sm ${
                    isUser
                      ? "border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-600/50 dark:bg-indigo-900/40 dark:text-indigo-100"
                      : "border-slate-200 bg-slate-50 dark:border-slate-700/70 dark:bg-slate-900/60"
                  }`}
                >
                  <div
                    className={`flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 ${
                      isUser ? "flex-row-reverse" : ""
                    }`}
                  >
                    <span className={`flex items-center gap-1 ${isUser ? "flex-row-reverse" : ""}`}>
                      <MessageSquare className="h-3 w-3" /> {isUser ? "You" : "Genie"}
                    </span>
                    {message.createdAt && (
                      <span className={isUser ? "pl-2 text-right" : "pl-2"}>
                        {formatDate(message.createdAt)}
                      </span>
                    )}
                  </div>
                  <div
                    className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed ${
                      isUser ? "text-right" : ""
                    }`}
                  >
                    {message.content || (isStreaming ? "." : "")}
                  </div>
                  {!isUser && isStreaming && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                      <Loader2 className="h-3 w-3 animate-spin" /> Generating answer...
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {/* Auto-scroll anchor */}
          <div ref={chatEndRef} />
        </div>

        {/* Composer */}
        <Textarea
          value={composer}
          onChange={(event) => setComposer(event.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") onAsk();
          }}
          placeholder="Ask about precedent, statutory interpretation, or drafting guidance..."
          rows={4}
          disabled={!activeThreadId}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-md"
            onClick={() => fileInputRef.current?.click()}
            disabled={!activeProjectId}
          >
            <Paperclip className="mr-1 h-4 w-4" /> Attach evidence
          </Button>
          <Button
            size="sm"
            className="rounded-md"
            onClick={onAsk}
            disabled={!activeThreadId || !composer.trim() || isGenerating}
          >
            {isGenerating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Ask Genie
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
</main>
            {/* RIGHT */}
            {showUtilities && (
              <aside className="lg:col-span-3 min-h-0">
                <div className="flex h-full min-h-0 flex-col gap-4 pr-1">
                  <Card className="border-neutral-200/70 dark:border-neutral-800/70">
                    <CardHeader className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <FileText className="h-4 w-4" /> Citations
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex-1 min-h-0 space-y-2 overflow-auto pr-1 text-sm">
                        {citations.map((item, index) => (
                          <div key={item.id ?? `citation-${index}`} className="rounded-md border border-dashed border-neutral-200 px-3 py-2 dark:border-neutral-700">
                            <div className="font-medium text-neutral-800 dark:text-neutral-100">
                              {item.cite ?? item.title ?? `Citation ${index + 1}`}
                            </div>
                            {(item.title && item.title !== item.cite) && (
                              <div className="text-xs text-neutral-600 dark:text-neutral-400">{item.title}</div>
                            )}
                            {item.span && <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{item.span}</div>}
                          </div>
                        ))}
                        {!citations.length && (
                          <div className="text-sm text-neutral-500 dark:text-neutral-400">
                            Ask Genie to see grounded citations here.
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-neutral-200/70 dark:border-neutral-800/70">
                    <CardHeader className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <FileText className="h-4 w-4" /> Brief notes
                      </div>
                      <Button variant="ghost" size="icon" className="rounded-md" onClick={() => activeProjectId && loadBrief(activeProjectId)} disabled={!activeProjectId} title="Refresh brief">
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </CardHeader>
                    <CardContent>
                      <div className="flex-1 min-h-0 space-y-2 overflow-auto pr-1 text-sm">
                        {briefItems.map((item) => (
                          <div key={item.id} className="rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800">
                            <div className="font-medium text-neutral-800 dark:text-neutral-100">{item.title}</div>
                            {item.cite && (<div className="text-xs text-neutral-500 dark:text-neutral-400">{item.cite}</div>)}
                            {item.note && (<div className="mt-1 text-xs text-neutral-500 dark:text-neutral-300">{item.note}</div>)}
                            {item.createdAt && (<div className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-500">{formatDate(item.createdAt)}</div>)}
                          </div>
                        ))}
                        {!briefItems.length && (
                          <div className="text-sm text-neutral-500 dark:text-neutral-400">
                            Add citations to the brief from your research workspace.
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-neutral-200/70 dark:border-neutral-800/70">
                    <CardHeader className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <AlertTriangle className="h-4 w-4" /> Needs attention
                      </div>
                      <Button variant="ghost" size="icon" className="rounded-md" onClick={() => activeProjectId && loadAttention(activeProjectId)} disabled={!activeProjectId} title="Refresh attention items">
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        {attentionItems.map((item) => {
                          const tone = severityTone[item.severity ?? "info"] ?? severityTone.info;
                          return <div key={item.id} className={`rounded-md border px-3 py-2 ${tone}`}>{item.message}</div>;
                        })}
                        {!attentionItems.length && (
                          <div className="text-sm text-neutral-500 dark:text-neutral-400">
                            No outstanding alerts for this project.
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-neutral-200/70 dark:border-neutral-800/70">
                    <CardHeader className="flex items-center gap-2 text-sm font-medium">
                      <Clock className="h-4 w-4" /> Activity history
                    </CardHeader>
                    <CardContent>
                      <div className="flex-1 min-h-0 space-y-2 overflow-auto pr-1 text-sm">
                        {searchHistory.map((item) => (
                          <div key={item.id} className="rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800">
                            <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                              <span className="uppercase tracking-wide">{item.kind}</span>
                              <span>{formatDate(item.createdAt)}</span>
                            </div>
                            <div className="mt-1 text-sm text-neutral-800 dark:text-neutral-100">{item.label}</div>
                            {typeof item.docCount === "number" && item.docCount > 0 && (
                              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                                {item.docCount} document{item.docCount === 1 ? "" : "s"}
                              </div>
                            )}
                          </div>
                        ))}
                        {!searchHistory.length && (
                          <div className="text-sm text-neutral-500 dark:text-neutral-400">
                            Searches and questions will appear here.
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </aside>
            )}
          </div>
        </div>
      </div>
      {renderModal()}
    </>
  );
};

export default ResearchEngine;












