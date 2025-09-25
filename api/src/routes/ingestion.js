import { Router } from "express";
import fetch from "node-fetch";
import { randomUUID } from "node:crypto";

import { all, logAuditEvent, one, run } from "../db.js";

export const ingestionRouter = Router({ mergeParams: true });

function serviceUrl() {
  return (process.env.INGESTION_SERVICE_URL || "http://localhost:8001").trim();
}

async function fetchUploadWithOwner(uploadId, userId) {
  return one(
    `SELECT u.*, w.owner_id AS "ownerId"
       FROM uploads u
       JOIN workspaces w ON w.id = u.workspace_id
      WHERE u.id=$1
        AND w.owner_id=$2`,
    [uploadId, userId]
  );
}

ingestionRouter.post("/:uploadId/ingest", async (req, res) => {
  try {
    const { uploadId } = req.params;
    const upload = await fetchUploadWithOwner(uploadId, req.user.id);
    if (!upload) {
      return res.status(404).json({ error: "upload not found" });
    }

    const jobId = randomUUID();
    const jobPayload = {
      uploadId,
      workspaceId: upload.workspace_id,
      userId: req.user.id,
      triggeredBy: req.user.email,
      options: req.body?.options || {},
    };

    await run(
      `INSERT INTO ingestion_jobs(id, upload_id, stage, status, detail)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [jobId, uploadId, "pipeline", "queued", JSON.stringify({ request: jobPayload })]
    );

    await logAuditEvent({
      actorId: req.user.id,
      scopeType: "ingestion-job",
      scopeId: jobId,
      action: "queued",
      metadata: { uploadId, options: jobPayload.options },
    }).catch(() => {});

    const url = `${serviceUrl().replace(/\/$/, "")}/ingest`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          upload_id: uploadId,
          storage_path: upload.storage_path,
          original_filename: upload.original_filename,
          workspace_id: upload.workspace_id,
          thread_id: upload.thread_id,
          options: jobPayload.options,
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        await run(
          `UPDATE ingestion_jobs
              SET status=$1,
                  detail = COALESCE(detail,'{}'::jsonb) || $2::jsonb,
                  completed_at=NOW()
            WHERE id=$3`,
          ["failed", JSON.stringify({ error: detail || "ingestion service error" }), jobId]
        );
        await logAuditEvent({
          actorId: req.user.id,
          scopeType: "ingestion-job",
          scopeId: jobId,
          action: "dispatch-failed",
          metadata: { error: detail },
        }).catch(() => {});
        return res.status(502).json({ error: "ingestion service error", detail });
      }

      await run(
        `UPDATE ingestion_jobs
            SET status=$1,
                detail = COALESCE(detail,'{}'::jsonb) || $2::jsonb,
                started_at=NOW()
          WHERE id=$3`,
        ["running", JSON.stringify({ dispatchedAt: new Date().toISOString() }), jobId]
      );
    } catch (err) {
      await run(
        `UPDATE ingestion_jobs
            SET status=$1,
                detail = COALESCE(detail,'{}'::jsonb) || $2::jsonb,
                completed_at=NOW()
          WHERE id=$3`,
        ["failed", JSON.stringify({ error: err?.message || "dispatch failed" }), jobId]
      );
      await logAuditEvent({
        actorId: req.user.id,
        scopeType: "ingestion-job",
        scopeId: jobId,
        action: "dispatch-error",
        metadata: { error: err?.message },
      }).catch(() => {});
      return res.status(502).json({ error: "failed to dispatch ingestion job", detail: err?.message });
    }

    await run(
      `UPDATE uploads
          SET ingest_status=$1,
              updated_at=NOW()
        WHERE id=$2`,
      ["processing", uploadId]
    );

    res.json({ jobId, status: "running" });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to trigger ingestion" });
  }
});

ingestionRouter.get("/:uploadId/jobs", async (req, res) => {
  try {
    const { uploadId } = req.params;
    const upload = await fetchUploadWithOwner(uploadId, req.user.id);
    if (!upload) {
      return res.status(404).json({ error: "upload not found" });
    }

    const items = await all(
      `SELECT id,
              stage,
              status,
              detail,
              started_at AS "startedAt",
              completed_at AS "completedAt"
         FROM ingestion_jobs
        WHERE upload_id=$1
        ORDER BY started_at DESC NULLS LAST, completed_at DESC NULLS LAST`,
      [uploadId]
    );

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to list ingestion jobs" });
  }
});

ingestionRouter.post("/:uploadId/jobs/:jobId/status", async (req, res) => {
  try {
    const secret = process.env.INGESTION_WEBHOOK_SECRET;
    if (!secret) {
      return res.status(501).json({ error: "webhook secret not configured" });
    }

    const provided = Array.isArray(req.headers["x-ingestion-secret"])
      ? req.headers["x-ingestion-secret"][0]
      : req.headers["x-ingestion-secret"];

    if (provided !== secret) {
      return res.status(401).json({ error: "invalid webhook secret" });
    }

    const { uploadId, jobId } = req.params;
    const job = await one(
      `SELECT id, upload_id FROM ingestion_jobs WHERE id=$1 AND upload_id=$2`,
      [jobId, uploadId]
    );
    if (!job) {
      return res.status(404).json({ error: "job not found" });
    }

    const { status, stage = null, detail = {}, ingestStatus = null } = req.body || {};
    if (!status) {
      return res.status(400).json({ error: "status required" });
    }

    await run(
      `UPDATE ingestion_jobs
          SET status=$1,
              stage=COALESCE($2, stage),
              detail = COALESCE(detail,'{}'::jsonb) || $3::jsonb,
              completed_at = CASE WHEN $1 IN ('completed','failed') THEN NOW() ELSE completed_at END
        WHERE id=$4`,
      [status, stage, JSON.stringify(detail), jobId]
    );

    if (ingestStatus) {
      await run(
        `UPDATE uploads
            SET ingest_status=$1,
                updated_at=NOW()
          WHERE id=$2`,
        [ingestStatus, uploadId]
      );
    }

    await logAuditEvent({
      actorId: null,
      scopeType: "ingestion-job",
      scopeId: jobId,
      action: `status-${status}`,
      metadata: { detail, stage, ingestStatus },
    }).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to update job status" });
  }
});
