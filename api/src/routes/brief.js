import { Router } from "express";
import { all, run, one } from "../db.js";
import { randomUUID } from "node:crypto";

export const briefRouter = Router();

async function ensureWorkspaceOwned(workspaceId, userId) {
  if (!workspaceId) return null;
  return await one(
    `SELECT id FROM workspaces WHERE id=$1 AND owner_id=$2`,
    [workspaceId, userId]
  );
}

briefRouter.get("/", async (req, res) => {
  try {
    const { projectId, threadId } = req.query;
    if (projectId) {
      const workspace = await ensureWorkspaceOwned(projectId, req.user.id);
      if (!workspace) return res.status(404).json({ error: "workspace not found" });

      const params = [projectId];
      let query = `SELECT id,
                          workspace_id AS "projectId",
                          thread_id AS "threadId",
                          title,
                          cite,
                          note,
                          created_at AS "createdAt"
                     FROM brief_items
                    WHERE workspace_id=$1`;
      if (threadId) {
        params.push(threadId);
        query += " AND thread_id=$2";
      }
      query += " ORDER BY created_at DESC";

      const items = await all(query, params);
      return res.json({ items });
    }

    const items = await all(
      `SELECT b.id,
              b.workspace_id AS "projectId",
              b.thread_id AS "threadId",
              b.title,
              b.cite,
              b.note,
              b.created_at AS "createdAt"
         FROM brief_items b
         JOIN workspaces w ON w.id = b.workspace_id
        WHERE w.owner_id = $1
        ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to load brief" });
  }
});

briefRouter.post("/", async (req, res) => {
  try {
    const { projectId, threadId = null, title, cite, note } = req.body || {};
    if (!projectId || !title) return res.status(400).json({ error: "projectId and title required" });
    const workspace = await ensureWorkspaceOwned(projectId, req.user.id);
    if (!workspace) return res.status(404).json({ error: "workspace not found" });
    const id = randomUUID();
    await run(
      `INSERT INTO brief_items(id, workspace_id, thread_id, title, cite, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, projectId, threadId, title.trim(), cite ?? null, note ?? null]
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to save brief item" });
  }
});

briefRouter.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const item = await one(
      `SELECT b.id, w.owner_id AS "ownerId"
         FROM brief_items b
         JOIN workspaces w ON w.id = b.workspace_id
        WHERE b.id=$1`,
      [id]
    );
    if (!item || item.ownerId !== req.user.id) return res.status(404).json({ error: "not found" });
    await run(`DELETE FROM brief_items WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to delete brief item" });
  }
});
