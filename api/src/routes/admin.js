// api/src/routes/admin.js
import path from "node:path";
import fs from "node:fs/promises";
import express from "express";
import neo4j from "neo4j-driver";
import { all, one } from "../db.js";

export const adminRouter = express.Router();

const DEFAULT_CHUNK_LIMIT = Number(process.env.ADMIN_CHUNK_LIMIT || 50);
const MAX_CHUNK_LIMIT = Number(process.env.ADMIN_CHUNK_LIMIT_MAX || 500);

const NEO4J_URI = process.env.PIPELINE_NEO4J_URI || process.env.NEO4J_URI || null;
const NEO4J_USER = process.env.PIPELINE_NEO4J_USER || process.env.NEO4J_USER || "neo4j";
const NEO4J_PASSWORD = process.env.PIPELINE_NEO4J_PASSWORD || process.env.NEO4J_PASSWORD || null;
const NEO4J_DATABASE = process.env.PIPELINE_NEO4J_DATABASE || process.env.NEO4J_DATABASE || null;

let cachedNeo4jDriver = null;

function getNeo4jDriver() {
  if (!NEO4J_URI || !NEO4J_PASSWORD) {
    return null;
  }
  if (!cachedNeo4jDriver) {
    cachedNeo4jDriver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  }
  return cachedNeo4jDriver;
}

function closeNeo4jDriver() {
  if (cachedNeo4jDriver) {
    try {
      cachedNeo4jDriver.close();
    } catch (err) {
      console.warn('Failed to close Neo4j driver cleanly:', err);
    } finally {
      cachedNeo4jDriver = null;
    }
  }
}

process.on('exit', closeNeo4jDriver);

function toNumber(value) {
  if (neo4j.isInt?.(value)) {
    return value.toNumber();
  }
  return typeof value === 'number' ? value : value ?? null;
}

function serializeProperties(props = {}) {
  const out = {};
  for (const [key, value] of Object.entries(props)) {
    if (Array.isArray(value)) {
      out[key] = value.map((item) => toNumber(item) ?? item);
    } else {
      out[key] = toNumber(value) ?? value;
    }
  }
  return out;
}

function getMapValue(map, key) {
  if (!map) return null;
  if (typeof map.get === 'function') {
    return map.get(key);
  }
  return map[key];
}

async function fetchIngestionJob(jobId) {
  return one(
    `SELECT j.id,
            j.upload_id AS "uploadId",
            j.stage,
            j.status,
            j.detail,
            j.started_at AS "startedAt",
            j.completed_at AS "completedAt",
            u.workspace_id AS "workspaceId",
            u.thread_id AS "threadId",
            u.original_filename AS "filename",
            u.storage_path AS "storagePath"
       FROM ingestion_jobs j
       JOIN uploads u ON u.id = j.upload_id
      WHERE j.id = $1`,
    [jobId]
  );
}

function resolveChunkPath(detail) {
  const chunkOutput = detail?.chunk?.output;
  if (!chunkOutput) return null;
  return path.resolve(process.cwd(), chunkOutput);
}

async function readChunksFromFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const items = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(`Failed to parse chunk JSON line ${i + 1}: ${err.message}`);
    }
    items.push({
      index: i,
      text: typeof parsed.text === 'string' ? parsed.text : '',
      metadata: parsed.metadata || {},
    });
  }
  return items;
}

const ALLOWED = new Set([
  "workspaces",
  "threads",
  "uploads",
  "messages",
  "brief_items",
  "users",
  "search_sessions",
  "audit_log",
  "ingestion_jobs",
]);

adminRouter.get("/ingestion-jobs", async (_req, res) => {
  try {
    const items = await all(
      `SELECT j.id,
              j.upload_id AS "uploadId",
              j.stage,
              j.status,
              j.detail,
              j.started_at AS "startedAt",
              j.completed_at AS "completedAt",
              u.workspace_id AS "workspaceId",
              u.original_filename AS "filename",
              u.ingest_status AS "uploadStatus"
         FROM ingestion_jobs j
         JOIN uploads u ON u.id = j.upload_id
        ORDER BY j.started_at DESC NULLS LAST
        LIMIT 200`
    );
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to load ingestion jobs" });
  }
});

adminRouter.get("/ingestion/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await fetchIngestionJob(jobId);
    if (!job) {
      return res.status(404).json({ error: "ingestion job not found" });
    }
    res.json({ job });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to load ingestion job" });
  }
});

adminRouter.get("/ingestion/:jobId/chunks", async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await fetchIngestionJob(jobId);
    if (!job) {
      return res.status(404).json({ error: "ingestion job not found" });
    }
    const chunkPath = resolveChunkPath(job.detail || {});
    if (!chunkPath) {
      return res.status(404).json({ error: "chunk output not recorded" });
    }

    let items;
    try {
      items = await readChunksFromFile(chunkPath);
    } catch (err) {
      if ((err && err.code) === "ENOENT") {
        return res.status(404).json({ error: "chunk file missing on disk" });
      }
      throw err;
    }

    const total = items.length;
    const rawOffset = Number.parseInt(String(req.query.offset ?? ''), 10);
    const rawLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
    let limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_CHUNK_LIMIT;
    if (limit > MAX_CHUNK_LIMIT) limit = MAX_CHUNK_LIMIT;

    const slice = items.slice(offset, offset + limit);
    const docId = job.detail?.chunk?.docId || slice[0]?.metadata?.doc_id || job.uploadId;

    res.json({
      jobId,
      uploadId: job.uploadId,
      filename: job.filename,
      workspaceId: job.workspaceId,
      threadId: job.threadId,
      docId,
      total,
      offset,
      limit,
      hasMore: offset + limit < total,
      chunkPath: path.relative(process.cwd(), chunkPath),
      items: slice,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to load chunk data" });
  }
});

adminRouter.get("/ingestion/:jobId/kg", async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await fetchIngestionJob(jobId);
    if (!job) {
      return res.status(404).json({ error: "ingestion job not found" });
    }

    const driver = getNeo4jDriver();
    if (!driver) {
      return res.status(503).json({ error: "neo4j connection not configured" });
    }

    const docId = job.detail?.chunk?.docId || job.uploadId;
    const chunkPath = resolveChunkPath(job.detail || {});
    let chunkItems = [];
    if (chunkPath) {
      try {
        chunkItems = await readChunksFromFile(chunkPath);
      } catch (err) {
        if ((err && err.code) !== "ENOENT") {
          throw err;
        }
      }
    }

    const chunkTextById = new Map();
    const chunkMetaById = new Map();
    for (const item of chunkItems) {
      const meta = item.metadata || {};
      const chunkUid = meta.chunk_uid || `${meta.doc_id || docId}:${meta.chunk_id ?? item.index}`;
      chunkTextById.set(chunkUid, item.text);
      chunkMetaById.set(chunkUid, meta);
    }

    const sessionConfig = NEO4J_DATABASE ? { database: NEO4J_DATABASE } : undefined;
    const session = driver.session(sessionConfig);
    try {
      const docResult = await session.run("MATCH (d:Document {id: $docId}) RETURN d LIMIT 1", { docId });

      if (!docResult.records.length) {
        return res.json({
          jobId,
          uploadId: job.uploadId,
          docId,
          document: null,
          chunks: [],
          entities: [],
        });
      }

      const documentProps = serializeProperties(docResult.records[0].get('d').properties);

      const chunkResult = await session.run(
        "MATCH (d:Document {id: $docId})-[:HAS_CHUNK]->(c:Chunk) " +
        "OPTIONAL MATCH (c)-[m:MENTIONS]->(e:Entity) " +
        "RETURN c, collect({entity: e, mention: m}) AS mentions ORDER BY coalesce(c.chunk_index, c.chunk_id, 0)",
        { docId }
      );

      const chunkSummaries = chunkResult.records.map((record) => {
        const chunkNode = record.get('c');
        const chunkProps = serializeProperties(chunkNode.properties);
        const chunkUid = chunkProps.id;
        const mentionsRaw = record.get('mentions') || [];
        const mentions = mentionsRaw
          .map((entry) => {
            const entityNode = getMapValue(entry, 'entity');
            if (!entityNode) return null;
            const mentionRel = getMapValue(entry, 'mention');
            const entityProps = serializeProperties(entityNode.properties);
            const mentionProps = mentionRel ? serializeProperties(mentionRel.properties) : {};
            return {
              entityKey: entityProps.key,
              label: entityProps.label,
              text: entityProps.text,
              normText: entityProps.norm_text,
              start: mentionProps.start ?? null,
              end: mentionProps.end ?? null,
              score: mentionProps.score ?? null,
              source: mentionProps.source ?? null,
            };
          })
          .filter(Boolean);

        return {
          id: chunkUid,
          chunkId: chunkProps.chunk_id ?? null,
          chunkIndex: chunkProps.chunk_index ?? null,
          totalChunks: chunkProps.total_chunks ?? null,
          text: chunkTextById.get(chunkUid) || null,
          metadata: chunkMetaById.get(chunkUid) || null,
          mentions,
        };
      });

      const entityResult = await session.run(
        "MATCH (d:Document {id: $docId})-[:HAS_CHUNK]->(c:Chunk)-[m:MENTIONS]->(e:Entity) " +
        "OPTIONAL MATCH (e)<-[:ALIAS_OF]-(a:Alias) " +
        "OPTIONAL MATCH (e)<-[:PHONETIC_OF]-(p:PhoneticAlias) " +
        "RETURN e, count(DISTINCT m) AS mentionCount, count(DISTINCT c) AS chunkCount, count(DISTINCT a) AS aliasCount, count(DISTINCT p) AS phoneticCount ORDER BY mentionCount DESC",
        { docId }
      );

      const entities = entityResult.records.map((record) => {
        const node = record.get('e');
        const props = serializeProperties(node.properties);
        return {
          ...props,
          mentionCount: toNumber(record.get('mentionCount')) ?? 0,
          chunkCount: toNumber(record.get('chunkCount')) ?? 0,
          aliasCount: toNumber(record.get('aliasCount')) ?? 0,
          phoneticCount: toNumber(record.get('phoneticCount')) ?? 0,
        };
      });

      res.json({
        jobId,
        uploadId: job.uploadId,
        docId,
        document: documentProps,
        chunks: chunkSummaries,
        entities,
      });
    } finally {
      await session.close();
    }
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to load knowledge graph view" });
  }
});

adminRouter.get("/:table", async (req, res) => {
  const { table } = req.params;
  if (!ALLOWED.has(table)) return res.status(400).json({ error: "bad table" });
  try {
    const rows = await all(
      `SELECT * FROM ${table} ORDER BY created_at DESC NULLS LAST LIMIT 200`
    );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message || "admin query failed" });
  }
});
