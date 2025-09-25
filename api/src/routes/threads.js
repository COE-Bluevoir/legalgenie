import { Router } from "express";
import { all, one, run } from "../db.js";
import { randomUUID } from "node:crypto";

export const threadsRouter = Router();

async function ensureWorkspaceOwned(workspaceId, userId) {
  if (!workspaceId) return null;
  return await one(
    `SELECT id FROM workspaces WHERE id=$1 AND owner_id=$2`,
    [workspaceId, userId]
  );
}

async function ensureThreadOwned(threadId, userId) {
  if (!threadId) return null;
  return await one(
    `SELECT t.id
       FROM threads t
       JOIN workspaces w ON w.id = t.workspace_id
      WHERE t.id = $1 AND w.owner_id = $2`,
    [threadId, userId]
  );
}

threadsRouter.get("/", async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: "projectId required" });
    const workspace = await ensureWorkspaceOwned(projectId, req.user.id);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const items = await all(
      `SELECT id,
              workspace_id AS "projectId",
              title,
              status,
              created_at AS "createdAt",
              updated_at AS "updatedAt"
         FROM threads
        WHERE workspace_id=$1
        ORDER BY created_at DESC`,
      [projectId]
    );
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to load threads" });
  }
});

threadsRouter.post("/", async (req, res) => {
  try {
    const { projectId, title } = req.body || {};
    if (!projectId || !title) return res.status(400).json({ error: "projectId and title required" });
    const workspace = await ensureWorkspaceOwned(projectId, req.user.id);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const id = randomUUID();
    await run(
      `INSERT INTO threads(id, workspace_id, title, created_by)
       VALUES ($1, $2, $3, $4)`,
      [id, projectId, title.trim(), req.user.id]
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to create thread" });
  }
});

threadsRouter.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, status } = req.body || {};
    const thread = await ensureThreadOwned(id, req.user.id);
    if (!thread) return res.status(404).json({ error: "not found" });
    const nextTitle = typeof title === "string" ? title.trim() : null;
    await run(
      `UPDATE threads
          SET title = COALESCE($1, title),
              status = COALESCE($2, status),
              updated_at = NOW()
        WHERE id=$3`,
      [nextTitle, status ?? null, id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to update thread" });
  }
});

threadsRouter.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const thread = await ensureThreadOwned(id, req.user.id);
    if (!thread) return res.status(404).json({ error: "not found" });
    await run(`DELETE FROM threads WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to delete thread" });
  }
});
