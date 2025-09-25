import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  Database,
  ListTree,
  FileText,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AdminAPI,
  type AdminChunksResponse,
  type AdminIngestionJob,
  type AdminKgResponse,
} from "@/lib/api";

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const truncateText = (value: string, limit = 480) => {
  if (!value) return "";
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
};

const statusVariant = (status: string) => {
  const normalized = status.toLowerCase();
  if (normalized === "completed" || normalized === "indexed") return "default" as const;
  if (normalized === "failed") return "destructive" as const;
  return "secondary" as const;
};

const AdminPanel: React.FC = () => {
  const [jobs, setJobs] = useState<AdminIngestionJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const [chunks, setChunks] = useState<AdminChunksResponse | null>(null);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [chunksError, setChunksError] = useState<string | null>(null);

  const [kg, setKg] = useState<AdminKgResponse | null>(null);
  const [kgLoading, setKgLoading] = useState(false);
  const [kgError, setKgError] = useState<string | null>(null);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId]
  );

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);
    const result = await AdminAPI.ingestionJobs();
    setJobsLoading(false);
    if (result.ok) {
      const items = result.data.items || [];
      setJobs(items);
      if (!selectedJobId && items.length) {
        setSelectedJobId(items[0].id);
      } else if (selectedJobId && !items.some((job) => job.id === selectedJobId)) {
        setSelectedJobId(items.length ? items[0].id : null);
      }
    } else {
      setJobsError(result.error);
      setJobs([]);
    }
  }, [selectedJobId]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (!selectedJobId) {
      setChunks(null);
      setKg(null);
      return;
    }

    let cancelled = false;

    const fetchChunks = async () => {
      setChunksLoading(true);
      setChunksError(null);
      const res = await AdminAPI.ingestionChunks(selectedJobId, { limit: 25 });
      if (cancelled) return;
      setChunksLoading(false);
      if (res.ok) {
        setChunks(res.data);
      } else {
        setChunksError(res.error);
        setChunks(null);
      }
    };

    const fetchKg = async () => {
      setKgLoading(true);
      setKgError(null);
      const res = await AdminAPI.ingestionKg(selectedJobId);
      if (cancelled) return;
      setKgLoading(false);
      if (res.ok) {
        setKg(res.data);
      } else {
        setKgError(res.error);
        setKg(null);
      }
    };

    fetchChunks();
    fetchKg();

    return () => {
      cancelled = true;
    };
  }, [selectedJobId]);

  const topEntities = useMemo(() => {
    if (!kg?.entities?.length) return [] as AdminKgResponse["entities"];
    return kg.entities.slice(0, 12);
  }, [kg]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Ingestion Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Monitor OCR extraction, chunking, embeddings, NER, and knowledge graph state for uploaded documents.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadJobs} disabled={jobsLoading}>
            {jobsLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid flex-1 gap-4 overflow-hidden lg:grid-cols-3">
        <Card className="flex flex-col overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base font-semibold">Ingestion Jobs</CardTitle>
            <Badge variant="outline">{jobs.length}</Badge>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden">
            {jobsError ? (
              <div className="flex h-full items-center justify-center text-sm text-red-500">
                <AlertTriangle className="mr-2 h-4 w-4" /> {jobsError}
              </div>
            ) : (
              <div className="flex h-full flex-col gap-2 overflow-y-auto pr-1">
                {jobsLoading && !jobs.length ? (
                  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading jobs…
                  </div>
                ) : null}
                {!jobsLoading && jobs.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    No ingestion jobs yet.
                  </div>
                ) : null}
                {jobs.map((job) => {
                  const isSelected = job.id === selectedJobId;
                  return (
                    <button
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      className={`flex flex-col gap-1 rounded-lg border px-3 py-2 text-left transition hover:border-primary hover:bg-primary/5 focus:outline-none ${
                        isSelected ? "border-primary bg-primary/10" : "border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
                        <span>{job.stage || "queued"}</span>
                        <Badge variant={statusVariant(job.status)} className="text-[10px]">
                          {job.status}
                        </Badge>
                      </div>
                      <div className="text-sm font-medium text-foreground">
                        {job.filename || job.uploadId}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Started {formatDateTime(job.startedAt)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4 overflow-hidden lg:col-span-2">
          <Card className="flex flex-1 flex-col overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base font-semibold">Chunk Preview</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Inspect OCR-normalized chunks before embedding and NER.
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {selectedJob ? (
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(selectedJob.status)}>{selectedJob.status}</Badge>
                    {selectedJob.stage ? (
                      <Badge variant="outline">{selectedJob.stage}</Badge>
                    ) : null}
                  </div>
                ) : null}
                {chunks?.total !== undefined ? (
                  <Badge variant="outline">
                    <FileText className="mr-1 h-3.5 w-3.5" /> {chunks.total} chunks
                  </Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden">
              {selectedJobId == null ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Select a job to view chunk data.
                </div>
              ) : chunksError ? (
                <div className="flex h-full items-center justify-center text-sm text-red-500">
                  <AlertTriangle className="mr-2 h-4 w-4" /> {chunksError}
                </div>
              ) : chunksLoading && !chunks ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading chunks…
                </div>
              ) : chunks && chunks.items.length ? (
                <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Doc ID:</span>
                    <Badge variant="secondary">{chunks.docId || "unknown"}</Badge>
                    <span>Path:</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{chunks.chunkPath}</code>
                    {chunks.hasMore ? (
                      <span className="text-xs text-muted-foreground">Showing first {chunks.items.length} chunks</span>
                    ) : null}
                  </div>
                  {chunks.items.map((item) => (
                    <div key={item.index} className="rounded-lg border border-border bg-background p-3 shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">Chunk {item.metadata?.chunk_id ?? item.index}</Badge>
                          {item.metadata?.text_length ? (
                            <span>{item.metadata.text_length} chars</span>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDateTime(item.metadata?.created_at)}
                        </div>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                        {truncateText(item.text, 600)}
                      </p>
                      {item.metadata ? (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer text-muted-foreground">Metadata</summary>
                          <pre className="mt-1 max-h-44 overflow-auto rounded-md bg-muted/60 p-2 text-[11px] leading-snug">
{JSON.stringify(item.metadata, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No chunk data available for this job yet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex flex-1 flex-col overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base font-semibold">Knowledge Graph</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Entities ingested into Neo4j with mention counts per chunk.
                </p>
              </div>
              {kg?.chunks ? (
                <Badge variant="outline">
                  <Database className="mr-1 h-3.5 w-3.5" /> {kg.chunks.length} chunks
                </Badge>
              ) : null}
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden">
              {selectedJobId == null ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Select a job to load KG context.
                </div>
              ) : kgError ? (
                <div className="flex h-full items-center justify-center text-sm text-red-500">
                  <AlertTriangle className="mr-2 h-4 w-4" /> {kgError}
                </div>
              ) : kgLoading && !kg ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading knowledge graph…
                </div>
              ) : kg && kg.document ? (
                <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">Doc: {kg.docId}</Badge>
                    {kg.document?.source_path ? (
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{kg.document.source_path}</code>
                    ) : null}
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3 shadow-sm">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                      <ListTree className="h-4 w-4" /> Entities ({kg.entities.length})
                    </div>
                    {topEntities.length ? (
                      <div className="overflow-auto">
                        <table className="min-w-full border-separate border-spacing-y-1 text-sm">
                          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                            <tr>
                              <th className="text-left">Label</th>
                              <th className="text-left">Text</th>
                              <th className="text-right">Mentions</th>
                              <th className="text-right">Chunks</th>
                            </tr>
                          </thead>
                          <tbody>
                            {topEntities.map((entity) => (
                              <tr key={entity.key || `${entity.label}-${entity.text}`} className="text-sm">
                                <td className="py-1 pr-3">
                                  <Badge variant="outline">{entity.label || "ENTITY"}</Badge>
                                </td>
                                <td className="py-1 pr-3 text-foreground">
                                  {entity.text || entity.normText || entity.norm_text || "—"}
                                </td>
                                <td className="py-1 pr-3 text-right text-muted-foreground">{entity.mentionCount}</td>
                                <td className="py-1 text-right text-muted-foreground">{entity.chunkCount}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">No entities detected for this document.</div>
                    )}
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3 shadow-sm">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                      <Database className="h-4 w-4" /> Chunk Mentions
                    </div>
                    {kg.chunks.length ? (
                      <div className="flex flex-col gap-2">
                        {kg.chunks.slice(0, 6).map((chunk) => (
                          <div key={chunk.id} className="rounded-md border border-dashed border-border/70 p-2">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>
                                Chunk {chunk.chunkIndex ?? chunk.chunkId ?? "?"} · {chunk.mentions.length} mentions
                              </span>
                              {chunk.metadata?.chunk_uid ? (
                                <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                                  {chunk.metadata.chunk_uid}
                                </code>
                              ) : null}
                            </div>
                            {chunk.text ? (
                              <p className="mt-1 text-xs text-foreground">
                                {truncateText(chunk.text, 260)}
                              </p>
                            ) : null}
                            {chunk.mentions.length ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {chunk.mentions.map((mention, idx) => (
                                  <Badge key={`${chunk.id}-m-${idx}`} variant="secondary" className="text-[10px]">
                                    {mention.label || "ENTITY"}: {mention.text || mention.entityKey}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                        {kg.chunks.length > 6 ? (
                          <div className="text-xs text-muted-foreground">
                            Showing first 6 of {kg.chunks.length} chunks.
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">No chunk metadata available.</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No knowledge graph data available.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
