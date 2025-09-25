// api/src/routes/messages.js
import { Router } from "express";
import { all, run, one } from "../db.js";
import { randomUUID } from "node:crypto";

export const messagesRouter = Router();

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

messagesRouter.get("/", async (req, res) => {
  try {
    const { threadId } = req.query;
    if (!threadId) return res.status(400).json({ error: "threadId required" });
    const thread = await ensureThreadOwned(threadId, req.user.id);
    if (!thread) return res.status(404).json({ error: "thread not found" });
    const items = await all(
      `SELECT id,
              thread_id AS "threadId",
              role,
              content,
              created_at AS "createdAt"
         FROM messages
        WHERE thread_id=$1
        ORDER BY created_at ASC`,
      [threadId]
    );
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to load messages" });
  }
});

messagesRouter.post("/", async (req, res) => {
  try {
    const { threadId, role, content } = req.body || {};
    if (!threadId || !role || !content) return res.status(400).json({ error: "threadId, role, content required" });
    const thread = await ensureThreadOwned(threadId, req.user.id);
    if (!thread) return res.status(404).json({ error: "thread not found" });
    const id = randomUUID();
    await run(
      `INSERT INTO messages(id, thread_id, role, content)
       VALUES ($1, $2, $3, $4)`,
      [id, threadId, role, content]
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to add message" });
  }
});

messagesRouter.post("/batch", async (req, res) => {
  try {
    const { threadId, items } = req.body || {};
    if (!threadId || !Array.isArray(items) || !items.length)
      return res.status(400).json({ error: "threadId and items[] required" });
    const thread = await ensureThreadOwned(threadId, req.user.id);
    if (!thread) return res.status(404).json({ error: "thread not found" });

    for (const it of items) {
      if (!it?.role || !it?.content) continue;
      const id = randomUUID();
      await run(
        `INSERT INTO messages(id, thread_id, role, content)
         VALUES ($1, $2, $3, $4)`,
        [id, threadId, it.role, it.content]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to add messages" });
  }
});

messagesRouter.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const message = await one(
      `SELECT m.id, w.owner_id AS "ownerId"
         FROM messages m
         JOIN threads t ON t.id = m.thread_id
         JOIN workspaces w ON w.id = t.workspace_id
        WHERE m.id=$1`,
      [id]
    );
    if (!message || message.ownerId !== req.user.id) return res.status(404).json({ error: "not found" });
    await run(`DELETE FROM messages WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to delete message" });
  }
});
