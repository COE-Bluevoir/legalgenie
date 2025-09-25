import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";

import { all, one, run, logAuditEvent } from "../db.js";
import { fetchUploadWithOwner, queueIngestionJob, resolveUploadFilePath } from "../services/ingestion-runner.js";

export const uploadsRouter = Router();

const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_BYTES || 50 * 1024 * 1024);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const UPLOADS_ROOT = path.resolve(process.cwd(), "data", "uploads");

function sanitizeFilename(name) {
  const parsed = path.parse(name || "document");
  const base = parsed.name
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "document";
  const ext = parsed.ext && parsed.ext.length <= 10 ? parsed.ext.replace(/[^a-z0-9.]/gi, "") : parsed.ext;
  return `${base}${ext || ""}`;
}

function toPosixRelative(fullPath) {
  const rel = path.relative(UPLOADS_ROOT, fullPath);
  return rel.split(path.sep).join("/");
}

async function ensureWorkspaceOwned(workspaceId, userId) {
  if (!workspaceId) return null;
  return one(
    "SELECT id, name FROM workspaces WHERE id=$1 AND owner_id=$2",
    [workspaceId, userId]
  );
}

async function ensureThreadInWorkspace(threadId, workspaceId) {
  if (!threadId) return null;
  return one(
    "SELECT id FROM threads WHERE id=$1 AND workspace_id=$2",
    [threadId, workspaceId]
  );
}

function parseBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(v)) return true;
    if (["false", "0", "no", "off"].includes(v)) return false;
  }
  return undefined;
}

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function sanitizeIngestionOptions(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};

  const numberFields = [
    ["chunkSize", "chunkSize"],
    ["chunkOverlap", "chunkOverlap"],
    ["embedBatchSize", "embedBatchSize"],
    ["chromaBatchSize", "chromaBatchSize"],
    ["nerBatchSize", "nerBatchSize"],
  ];
  for (const [key, prop] of numberFields) {
    const val = parseNumber(raw[key]);
    if (val !== undefined) out[prop] = val;
  }

  const boolFields = [
    ["skipOCR", "skipOCR"],
    ["forceOCR", "forceOCR"],
    ["enableNER", "enableNER"],
    ["enableNeo4j", "enableNeo4j"],
  ];
  for (const [key, prop] of boolFields) {
    const val = parseBoolean(raw[key]);
    if (val !== undefined) out[prop] = val;
  }

  const stringFields = [
    ["modelPath", "modelPath"],
    ["device", "device"],
    ["chromaPath", "chromaPath"],
    ["collection", "collection"],
    ["collectionSuffix", "collectionSuffix"],
    ["nerFramework", "nerFramework"],
    ["spacyModel", "spacyModel"],
    ["nerEnv", "nerEnv"],
    ["nerModelPath", "nerModelPath"],
    ["aggregation", "aggregation"],
    ["neo4jUri", "neo4jUri"],
    ["neo4jUser", "neo4jUser"],
    ["neo4jPassword", "neo4jPassword"],
    ["neo4jDatabase", "neo4jDatabase"],
  ];
  for (const [key, prop] of stringFields) {
    const val = raw[key];
    if (typeof val === "string" && val.trim()) {
      out[prop] = val.trim();
    }
  }

  return out;
}

uploadsRouter.get("/", async (req, res) => {
  try {
    const projectId = req.query.projectId;
    if (!projectId) {
      return res.status(400).json({ error: "projectId required" });
    }
    const workspace = await ensureWorkspaceOwned(projectId, req.user.id);
    if (!workspace) {
      return res.status(404).json({ error: "workspace not found" });
    }

    const rows = await all(
      `SELECT id,
              workspace_id AS "projectId",
              thread_id AS "threadId",
              original_filename AS "name",
              storage_path AS "path",
              size_bytes AS "size",
              mime_type AS "mimeType",
              ingest_status AS "status",
              checksum,
              created_at AS "createdAt",
              updated_at AS "updatedAt"
         FROM uploads
        WHERE workspace_id=$1
        ORDER BY created_at DESC`,
      [projectId]
    );

    const items = rows.map((row) => ({
      ...row,
      indexed: row.status === "indexed" ? 1 : 0,
    }));

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to list uploads" });
  }
});

uploadsRouter.post(
  "/",
  upload.single("file"),
  async (req, res) => {
    try {
      const { projectId, threadId = null } = req.body || {};
      if (!projectId) {
        return res.status(400).json({ error: "projectId required" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "file required" });
      }

      const workspace = await ensureWorkspaceOwned(projectId, req.user.id);
      if (!workspace) {
        return res.status(404).json({ error: "workspace not found" });
      }
      if (threadId) {
        const thread = await ensureThreadInWorkspace(threadId, projectId);
        if (!thread) {
          return res.status(404).json({ error: "thread not found in workspace" });
        }
      }

      const uploadId = randomUUID();
      const originalName = req.file.originalname || "upload";
      const safeName = sanitizeFilename(originalName);
      const destDir = path.join(UPLOADS_ROOT, projectId, uploadId);
      await fs.mkdir(destDir, { recursive: true });
      const destPath = path.join(destDir, safeName);
      await fs.writeFile(destPath, req.file.buffer);

      const checksum = createHash("sha256").update(req.file.buffer).digest("hex");
      const storagePath = toPosixRelative(destPath);

      const inserted = await one(
        `INSERT INTO uploads(id, workspace_id, thread_id, original_filename, storage_path, size_bytes, mime_type, checksum, ingest_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id,
                   workspace_id AS "projectId",
                   thread_id AS "threadId",
                   original_filename AS "name",
                   storage_path AS "path",
                   size_bytes AS "size",
                   mime_type AS "mimeType",
                   ingest_status AS "status",
                   checksum,
                   created_at AS "createdAt"`,
        [
          uploadId,
          projectId,
          threadId || null,
          originalName,
          storagePath,
          req.file.size,
          req.file.mimetype || null,
          checksum,
          "pending",
        ]
      );

      await logAuditEvent({
        actorId: req.user.id,
        scopeType: "upload",
        scopeId: uploadId,
        action: "created",
        metadata: {
          projectId,
          threadId,
          name: originalName,
          size: req.file.size,
          checksum,
        },
      }).catch(() => {});

      res.status(201).json({
        ...inserted,
        indexed: inserted.status === "indexed" ? 1 : 0,
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "failed to upload file" });
    }
  }
);

uploadsRouter.post("/:uploadId/ingest", async (req, res) => {
  try {
    const { uploadId } = req.params;
    const upload = await fetchUploadWithOwner(uploadId, req.user.id);
    if (!upload) {
      return res.status(404).json({ error: "upload not found" });
    }

    const runningJob = await one(
      "SELECT id FROM ingestion_jobs WHERE upload_id=$1 AND status IN ($2,$3)",
      [uploadId, "queued", "running"]
    );
    if (runningJob) {
      return res.status(409).json({ error: "ingestion already in progress", jobId: runningJob.id });
    }

    const options = sanitizeIngestionOptions(req.body?.options || {});
    const { jobId } = await queueIngestionJob({
      upload,
      user: req.user,
      options,
    });

    res.json({ jobId, status: "queued" });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to start ingestion" });
  }
});

uploadsRouter.get("/:uploadId/jobs", async (req, res) => {
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
    res.status(500).json({ error: err.message || "failed to load jobs" });
  }
});

uploadsRouter.post("/:uploadId/indexed", async (req, res) => {
  try {
    const { uploadId } = req.params;
    const upload = await fetchUploadWithOwner(uploadId, req.user.id);
    if (!upload) {
      return res.status(404).json({ error: "upload not found" });
    }

    await run(
      "UPDATE uploads SET ingest_status=$1, updated_at=NOW() WHERE id=$2",
      ["indexed", uploadId]
    );

    await logAuditEvent({
      actorId: req.user.id,
      scopeType: "upload",
      scopeId: uploadId,
      action: "marked-indexed",
      metadata: { uploadId },
    }).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to mark indexed" });
  }
});

uploadsRouter.delete("/:uploadId", async (req, res) => {
  try {
    const { uploadId } = req.params;
    const upload = await fetchUploadWithOwner(uploadId, req.user.id);
    if (!upload) {
      return res.status(404).json({ error: "upload not found" });
    }

    await run("DELETE FROM uploads WHERE id=$1", [uploadId]).catch(() => {});

    const absolutePath = resolveUploadFilePath(upload.storage_path);
    const parentDir = path.dirname(absolutePath);
    await fs.rm(parentDir, { recursive: true, force: true }).catch(() => {});

    await logAuditEvent({
      actorId: req.user.id,
      scopeType: "upload",
      scopeId: uploadId,
      action: "deleted",
      metadata: { uploadId },
    }).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to delete upload" });
  }
});

uploadsRouter.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: `file too large (max ${MAX_UPLOAD_BYTES} bytes)` });
    }
    return res.status(400).json({ error: err.message });
  }
  return next(err);
});
