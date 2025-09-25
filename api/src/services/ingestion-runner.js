import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

import { one, run, logAuditEvent } from "../db.js";

const UPLOADS_ROOT = path.resolve(process.cwd(), "data", "uploads");
const PIPELINE_ROOT = process.env.PIPELINE_ROOT
  ? path.resolve(process.env.PIPELINE_ROOT)
  : path.resolve(process.cwd(), "..", "lg_pipeline");
const PIPELINE_PYTHON = process.env.PIPELINE_PYTHON || process.env.PYTHON_BIN || "python";

const PIPELINE_MODEL_PATH = process.env.PIPELINE_MODEL_PATH || process.env.MODEL_PATH || null;
const PIPELINE_DEVICE = process.env.PIPELINE_DEVICE || process.env.EMBED_DEVICE || "cpu";
const PIPELINE_CHUNK_SIZE = Number(process.env.PIPELINE_CHUNK_SIZE || 1200);
const PIPELINE_CHUNK_OVERLAP = Number(process.env.PIPELINE_CHUNK_OVERLAP || 200);
const PIPELINE_EMBED_BATCH = Number(process.env.PIPELINE_EMBED_BATCH || 32);
const PIPELINE_CHROMA_BATCH = Number(process.env.PIPELINE_CHROMA_BATCH || 128);
const PIPELINE_CHROMA_PATH = process.env.PIPELINE_CHROMA_PATH
  ? path.resolve(process.env.PIPELINE_CHROMA_PATH)
  : path.join(PIPELINE_ROOT, ".chroma");
const PIPELINE_COLLECTION_PREFIX = process.env.PIPELINE_COLLECTION_PREFIX || "workspace_";

const PIPELINE_ENABLE_NER = envFlag("PIPELINE_ENABLE_NER", true);
const PIPELINE_NER_FRAMEWORK = process.env.PIPELINE_NER_FRAMEWORK || "spacy";
const PIPELINE_SPACY_MODEL = process.env.PIPELINE_SPACY_MODEL || "en_legal_ner_trf";
const PIPELINE_NER_ENV = process.env.PIPELINE_NER_ENV || "ner_env";
const PIPELINE_NER_BATCH = Number(process.env.PIPELINE_NER_BATCH || 16);
const PIPELINE_ENABLE_NEO4J = envFlag("PIPELINE_ENABLE_NEO4J", true);
const PIPELINE_NEO4J_URI = process.env.PIPELINE_NEO4J_URI || process.env.NEO4J_URI || null;
const PIPELINE_NEO4J_USER = process.env.PIPELINE_NEO4J_USER || process.env.NEO4J_USER || "neo4j";
const PIPELINE_NEO4J_PASSWORD = process.env.PIPELINE_NEO4J_PASSWORD || process.env.NEO4J_PASSWORD || null;
const PIPELINE_NEO4J_DATABASE = process.env.PIPELINE_NEO4J_DATABASE || process.env.NEO4J_DATABASE || null;

const PIPELINE_ENV = {
  ...process.env,
  PYTHONUTF8: "1",
};

const OCR_ROOT = process.env.PIPELINE_OCR_ROOT
  ? path.resolve(process.env.PIPELINE_OCR_ROOT)
  : path.resolve(process.cwd(), "..", "OCR", "OCR");
const OCR_ENABLE_DEFAULT = (process.env.PIPELINE_ENABLE_OCR || "true").toLowerCase() !== "false";
const OCR_EXTENSIONS = new Set(
  (process.env.PIPELINE_OCR_EXT || ".pdf,.png,.jpg,.jpeg,.tiff,.tif").split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
);

const SUPPORTED_OCR_EXT = OCR_EXTENSIONS;

function envFlag(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["1","true","yes","on"].includes(normalized)) return true;
  if (["0","false","no","off"].includes(normalized)) return false;
  return defaultValue;
}


function resolveUploadPath(storagePath) {
  if (!storagePath) {
    throw new Error("Upload record is missing storage_path");
  }
  if (path.isAbsolute(storagePath)) {
    return storagePath;
  }
  return path.join(UPLOADS_ROOT, storagePath);
}

function sanitizeName(name) {
  return (
    (name || "")
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") ||
    "document"
  );
}

function truncate(text, limit = 4000) {
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

async function runProcess(command, args, { cwd, env, logPrefix } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (logPrefix) process.stdout.write(`[${logPrefix}] ${text}`);
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (logPrefix) process.stderr.write(`[${logPrefix}] ${text}`);
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        const error = new Error(`${command} exited with code ${code}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

function shouldUseOcr(filePath, options = {}) {
  if (options.skipOCR === true) return false;
  if (options.forceOCR === true) return true;
  if (!OCR_ENABLE_DEFAULT) return false;
  const ext = path.extname(filePath || "").toLowerCase();
  return SUPPORTED_OCR_EXT.has(ext);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function runOcr(filePath, jobDir, options = {}) {
  const python = options.python || PIPELINE_PYTHON;
  const root = options.ocrRoot || OCR_ROOT;
  await ensureDir(jobDir);

  const pythonCode = [
    "import json, sys, io, contextlib",
    `sys.path.insert(0, r"${root.replace(/\\/g, "\\\\")}")`,
    "from config_OCR import ocr_adapter",
    "buffer = io.StringIO()",
    `with contextlib.redirect_stdout(buffer):`,
    `    text = ocr_adapter(r"${filePath.replace(/\\/g, "\\\\")}")`,
    "logs = buffer.getvalue()",
    "print(json.dumps({\"text\": text, \"logs\": logs}, ensure_ascii=False))",
  ].join("\n");

  const { stdout, stderr } = await runProcess(
    python,
    ["-c", pythonCode],
    { cwd: root, env: PIPELINE_ENV, logPrefix: "ocr" }
  );

  if (stderr) {
    console.warn(`[ocr] ${stderr}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (err) {
    throw new Error(`Failed to parse OCR output: ${err.message}`);
  }

  const safeBase = sanitizeName(path.parse(filePath).name);
  const jsonPath = path.join(jobDir, `${safeBase}.ocr.json`);
  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        results: [
          {
            id: options.docId || safeBase,
            doc: parsed.text || "",
          },
        ],
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    jsonPath,
    textLength: (parsed.text || "").length,
    logs: parsed.logs || "",
  };
}

async function runLangGraph(mode, args, { logPrefix } = {}) {
  const fullArgs = ["-m", "app.main", "--mode", mode, ...args];
  return runProcess(PIPELINE_PYTHON, fullArgs, {
    cwd: PIPELINE_ROOT,
    env: PIPELINE_ENV,
    logPrefix,
  });
}

async function setJobStatus(jobId, {
  status,
  stage,
  detail,
  setStarted = false,
  setCompleted = false,
} = {}) {
  const fields = [];
  const params = [];
  let idx = 1;

  if (status) {
    fields.push(`status=$${idx++}`);
    params.push(status);
  }
  if (stage !== undefined) {
    fields.push(`stage=$${idx++}`);
    params.push(stage);
  }
  if (detail) {
    fields.push(`detail = COALESCE(detail,'{}'::jsonb) || $${idx}::jsonb`);
    params.push(JSON.stringify(detail));
    idx += 1;
  }
  if (setStarted) {
    fields.push("started_at=COALESCE(started_at, NOW())");
  }
  if (setCompleted) {
    fields.push("completed_at=NOW()");
  }

  if (!fields.length) return;

  await run(
    `UPDATE ingestion_jobs SET ${fields.join(', ')} WHERE id=$${idx}`,
    [...params, jobId]
  );
}

async function appendJobDetail(jobId, detail) {
  await run(
    "UPDATE ingestion_jobs SET detail = COALESCE(detail,'{}'::jsonb) || $1::jsonb WHERE id=$2",
    [JSON.stringify(detail), jobId]
  );
}

function buildCollectionName(upload, options = {}) {
  if (options.collection) return options.collection;
  if (options.collectionSuffix) {
    return `${PIPELINE_COLLECTION_PREFIX}${options.collectionSuffix}`;
  }
  const postfix = sanitizeName(upload.workspace_id || upload.workspaceId || "default").toLowerCase();
  return `${PIPELINE_COLLECTION_PREFIX}${postfix || 'default'}`;
}

function toRelative(p) {
  return path.relative(process.cwd(), p);
}

async function normalizeChunkFile(chunkPath, { upload, storagePath, chunkSize, chunkOverlap }) {
  const absoluteSource = storagePath;
  const relativeSource = path.relative(process.cwd(), absoluteSource);
  const raw = await fs.readFile(chunkPath, 'utf8');
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const normalized = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(`Unable to parse chunk JSON on line ${i + 1}: ${err.message}`);
    }

    const textContent =
      typeof parsed.text === 'string'
        ? parsed.text
        : typeof parsed.doc === 'string'
          ? parsed.doc
          : '';

    const metadata = { ...(parsed.metadata || {}) };

    const originalCaseId = metadata.case_id || parsed.case_id || null;

    const chunkNumericId =
      metadata.chunk_id !== undefined && metadata.chunk_id !== null
        ? metadata.chunk_id
        : parsed.chunk_id !== undefined && parsed.chunk_id !== null
          ? parsed.chunk_id
          : parsed.chunkIndex !== undefined && parsed.chunkIndex !== null
            ? parsed.chunkIndex
            : i;

    metadata.chunk_id = chunkNumericId;
    metadata.chunk_index = i;
    metadata.doc_id = upload.id;
    metadata.upload_id = upload.id;
    metadata.workspace_id = upload.workspace_id || upload.workspaceId || null;
    if (upload.thread_id || upload.threadId) {
      metadata.thread_id = upload.thread_id || upload.threadId;
    }
    metadata.case_id = metadata.case_id || parsed.case_id || upload.id;
    metadata.original_case_id = metadata.original_case_id || originalCaseId || metadata.case_id;
    metadata.source_path = metadata.source_path || absoluteSource;
    metadata.storage_path = metadata.storage_path || absoluteSource;
    metadata.source_path_relative = metadata.source_path_relative || relativeSource;
    metadata.storage_path_relative = metadata.storage_path_relative || relativeSource;
    metadata.text_length = metadata.text_length || textContent.length;
    metadata.splitter_config = (metadata.splitter_config && typeof metadata.splitter_config === 'object')
      ? {
          chunk_size: metadata.splitter_config.chunk_size ?? chunkSize,
          chunk_overlap: metadata.splitter_config.chunk_overlap ?? chunkOverlap,
          separators: Object.prototype.hasOwnProperty.call(metadata.splitter_config, 'separators')
            ? metadata.splitter_config.separators
            : null,
        }
      : {
          chunk_size: chunkSize,
          chunk_overlap: chunkOverlap,
          separators: null,
        };
    metadata.total_chunks = lines.length;
    metadata.chunk_uid = metadata.chunk_uid || `${upload.id}:${chunkNumericId}`;

    normalized.push({
      text: textContent,
      metadata,
    });
  }

  const total = normalized.length;
  for (let i = 0; i < total; i += 1) {
    const meta = normalized[i].metadata;
    meta.chunk_index = i;
    if (meta.chunk_id === undefined || meta.chunk_id === null) {
      meta.chunk_id = i;
    }
    meta.total_chunks = total;
  }

  const serialized = normalized.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  await fs.writeFile(chunkPath, serialized, 'utf8');

  return { total };
}

export async function fetchUploadWithOwner(uploadId, ownerId) {
  return one(
    `SELECT u.*, w.owner_id AS "ownerId", w.name AS "workspaceName"
       FROM uploads u
       JOIN workspaces w ON w.id = u.workspace_id
      WHERE u.id=$1 AND w.owner_id=$2`,
    [uploadId, ownerId]
  );
}

export async function queueIngestionJob({ upload, user, options = {} }) {
  if (!upload) throw new Error('upload is required');

  const jobId = randomUUID();
  const detail = {
    request: {
      uploadId: upload.id,
      workspaceId: upload.workspace_id,
      threadId: upload.thread_id,
      triggeredBy: user?.email || null,
      options,
    },
  };

  await run(
    'INSERT INTO ingestion_jobs(id, upload_id, stage, status, detail) VALUES ($1,$2,$3,$4,$5::jsonb)',
    [jobId, upload.id, 'queued', 'queued', JSON.stringify(detail)]
  );

  await run(
    'UPDATE uploads SET ingest_status=$1, updated_at=NOW() WHERE id=$2',
    ['processing', upload.id]
  );

  await logAuditEvent({
    actorId: user?.id || null,
    scopeType: 'ingestion-job',
    scopeId: jobId,
    action: 'queued',
    metadata: { uploadId: upload.id, options },
  }).catch(() => {});

  setImmediate(() => {
    runIngestionPipeline({ upload, user, jobId, options }).catch((err) => {
      console.error('Ingestion job failed to start:', err);
    });
  });

  return { jobId };
}

async function runIngestionPipeline({ upload, user, jobId, options = {} }) {
  try {
    await setJobStatus(jobId, {
      status: 'running',
      stage: 'prepare',
      detail: { startedAt: new Date().toISOString() },
      setStarted: true,
    });

    const storagePath = resolveUploadPath(upload.storage_path);
    await fs.access(storagePath);

    const fileDir = path.dirname(storagePath);
    const jobDir = path.join(fileDir, 'jobs', jobId);
    await ensureDir(jobDir);

    const baseName = sanitizeName(path.parse(storagePath).name);
    const chunkOutput = path.join(jobDir, `${baseName}.chunks.jsonl`);

    let chunkMode = 'docx';
    let chunkInput = storagePath;
    let ocrDetail = null;

    if (shouldUseOcr(storagePath, options)) {
      await setJobStatus(jobId, { stage: 'ocr' });
      ocrDetail = await runOcr(storagePath, jobDir, {
        python: PIPELINE_PYTHON,
        ocrRoot: OCR_ROOT,
        docId: upload.id,
      });
      chunkMode = 'json';
      chunkInput = ocrDetail.jsonPath;
      await appendJobDetail(jobId, {
        ocr: {
          jsonPath: toRelative(ocrDetail.jsonPath),
          textLength: ocrDetail.textLength,
          logs: truncate(ocrDetail.logs, 2000),
        },
      });
    }

    await setJobStatus(jobId, { stage: 'chunk' });
    const chunkSize = Number(options.chunkSize || PIPELINE_CHUNK_SIZE);
    const chunkOverlap = Number(options.chunkOverlap || PIPELINE_CHUNK_OVERLAP);
    const chunkArgs = ['--input', chunkInput, '--output', chunkOutput, '--chunk-size', String(chunkSize), '--chunk-overlap', String(chunkOverlap)];
    const chunkResult = await runLangGraph(chunkMode, chunkArgs, { logPrefix: 'chunk' });
    const chunkNormalization = await normalizeChunkFile(chunkOutput, {
      upload,
      storagePath,
      chunkSize,
      chunkOverlap,
    });
    await appendJobDetail(jobId, {
      chunk: {
        mode: chunkMode,
        output: toRelative(chunkOutput),
        sourcePath: toRelative(storagePath),
        docId: upload.id,
        totalChunks: chunkNormalization.total,
        chunkSize,
        chunkOverlap,
        normalized: true,
        stdout: truncate(chunkResult.stdout),
        stderr: truncate(chunkResult.stderr),
      },
    });

    const modelPath = options.modelPath || PIPELINE_MODEL_PATH;
    if (!modelPath) {
      throw new Error('Embedding model path not configured. Set PIPELINE_MODEL_PATH or provide options.modelPath.');
    }

    const embeddingsOutput = path.join(jobDir, `${baseName}.embeddings.jsonl`);
    await setJobStatus(jobId, { stage: 'embed' });
    const embedArgs = [
      '--input', chunkOutput,
      '--output', embeddingsOutput,
      '--model-path', modelPath,
      '--batch-size', String(options.embedBatchSize || PIPELINE_EMBED_BATCH),
      '--device', options.device || PIPELINE_DEVICE,
    ];
    const embedResult = await runLangGraph('embed', embedArgs, { logPrefix: 'embed' });
    await appendJobDetail(jobId, {
      embed: {
        modelPath,
        output: toRelative(embeddingsOutput),
        stdout: truncate(embedResult.stdout),
        stderr: truncate(embedResult.stderr),
      },
    });

    const chromaPath = options.chromaPath
      ? path.resolve(options.chromaPath)
      : PIPELINE_CHROMA_PATH;
    await ensureDir(chromaPath);
    const collection = buildCollectionName(upload, options);
    await setJobStatus(jobId, { stage: 'chroma' });
    const chromaArgs = [
      '--input', embeddingsOutput,
      '--chroma-path', chromaPath,
      '--collection', collection,
      '--batch-size', String(options.chromaBatchSize || PIPELINE_CHROMA_BATCH),
    ];
    const chromaResult = await runLangGraph('chroma', chromaArgs, { logPrefix: 'chroma' });
    await appendJobDetail(jobId, {
      chroma: {
        chromaPath,
        collection,
        stdout: truncate(chromaResult.stdout),
        stderr: truncate(chromaResult.stderr),
      },
    });

    let nerOutput = null;
    const nerEnabled = options.enableNER === true || (options.enableNER === undefined && PIPELINE_ENABLE_NER);
    if (nerEnabled) {
      await setJobStatus(jobId, { stage: 'ner' });
      nerOutput = path.join(jobDir, `${baseName}.ner.jsonl`);
      const nerArgs = [
        '--input', chunkOutput,
        '--output', nerOutput,
        '--framework', options.nerFramework || PIPELINE_NER_FRAMEWORK,
        '--spacy-model', options.spacyModel || PIPELINE_SPACY_MODEL,
        '--ner-env', options.nerEnv || PIPELINE_NER_ENV,
        '--batch-size', String(options.nerBatchSize || PIPELINE_NER_BATCH),
      ];
      if (options.nerModelPath) {
        nerArgs.push('--ner-model-path', options.nerModelPath);
      }
      if (options.aggregation) {
        nerArgs.push('--aggregation', options.aggregation);
      }
      const nerResult = await runLangGraph('ner', nerArgs, { logPrefix: 'ner' });
      await appendJobDetail(jobId, {
        ner: {
          output: toRelative(nerOutput),
          stdout: truncate(nerResult.stdout),
          stderr: truncate(nerResult.stderr),
        },
      });
    }

    const neoEnabled = options.enableNeo4j === true || (options.enableNeo4j === undefined && PIPELINE_ENABLE_NEO4J);
    if (neoEnabled && nerOutput) {
      if (!PIPELINE_NEO4J_URI || !PIPELINE_NEO4J_PASSWORD) {
        console.warn('Neo4j ingestion skipped: missing PIPELINE_NEO4J_URI or PIPELINE_NEO4J_PASSWORD');
      } else {
        await setJobStatus(jobId, { stage: 'neo4j' });
        const neoArgs = [
          '--input', nerOutput,
          '--neo4j-uri', options.neo4jUri || PIPELINE_NEO4J_URI,
          '--neo4j-user', options.neo4jUser || PIPELINE_NEO4J_USER,
          '--neo4j-password', options.neo4jPassword || PIPELINE_NEO4J_PASSWORD,
        ];
        if (options.neo4jDatabase || PIPELINE_NEO4J_DATABASE) {
          neoArgs.push('--neo4j-database', options.neo4jDatabase || PIPELINE_NEO4J_DATABASE);
        }
        const neoResult = await runLangGraph('neo4j', neoArgs, { logPrefix: 'neo4j' });
        await appendJobDetail(jobId, {
          neo4j: {
            uri: options.neo4jUri || PIPELINE_NEO4J_URI,
            stdout: truncate(neoResult.stdout),
            stderr: truncate(neoResult.stderr),
          },
        });
      }
    }

    await setJobStatus(jobId, {
      status: 'completed',
      stage: 'completed',
      detail: { completedAt: new Date().toISOString(), jobDir: toRelative(jobDir) },
      setCompleted: true,
    });

    await run(
      'UPDATE uploads SET ingest_status=$1, updated_at=NOW() WHERE id=$2',
      ['indexed', upload.id]
    );

    await logAuditEvent({
      actorId: user?.id || null,
      scopeType: 'ingestion-job',
      scopeId: jobId,
      action: 'completed',
      metadata: { uploadId: upload.id },
    }).catch(() => {});
  } catch (err) {
    console.error('Ingestion pipeline failed:', err);
    await setJobStatus(jobId, {
      status: 'failed',
      stage: 'failed',
      detail: {
        error: err.message,
        stack: truncate(err.stack || '', 4000),
        failedAt: new Date().toISOString(),
      },
      setCompleted: true,
    });
    await run(
      'UPDATE uploads SET ingest_status=$1, updated_at=NOW() WHERE id=$2',
      ['failed', upload.id]
    );
    await logAuditEvent({
      actorId: user?.id || null,
      scopeType: 'ingestion-job',
      scopeId: jobId,
      action: 'failed',
      metadata: { uploadId: upload.id, error: err.message },
    }).catch(() => {});
  }
}

export function resolveUploadFilePath(storagePath) {
  return resolveUploadPath(storagePath);
}
