import { Router } from "express";
import { vector } from "../vector/index.js";
import { logSearchSession, logAuditEvent } from "../db.js";

export const vectorRouter = Router();

function maybeWorkspaceId(body) {
  return body?.projectId || body?.workspaceId || null;
}

vectorRouter.post('/search', async (req, res) => {
  try {
    const { query, topK, filters, threadId = null, projectId = null } = req.body || {};
    if (!query) {
      return res.status(400).json({ error: 'query required' });
    }
    const started = Date.now();
    const data = await vector.search({ query, topK, filters });
    const latency = Date.now() - started;
    await logSearchSession({
      userId: req.user.id,
      workspaceId: projectId || maybeWorkspaceId(req.body),
      threadId,
      mode: 'vector-search',
      queryText: query,
      topK: topK ?? null,
      latencyMs: latency,
      reasoningModel: data?.metadata?.source || null,
      metadata: { filters }
    });
    res.json(data);
  } catch (e) {
    await logAuditEvent({
      actorId: req.user.id,
      scopeType: 'vector-search',
      scopeId: null,
      action: 'error',
      metadata: { message: e?.message }
    }).catch(() => {});
    res.status(500).send(e.message || 'Vector search failed');
  }
});
