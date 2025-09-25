import { Router } from "express";
import { all, one, run } from "../db.js";
import { randomUUID } from "node:crypto";

export const projectsRouter = Router();

projectsRouter.get("/", async (req, res) => {
  try {
    const items = await all(
      `SELECT id,
              name,
              description,
              owner_id AS "userId",
              created_at AS "createdAt"
         FROM workspaces
        WHERE owner_id=$1
        ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to load workspaces" });
  }
});

projectsRouter.post("/", async (req, res) => {
  try {
    const { name, description } = req.body || {};
    const trimmed = (name || "").trim();
    if (!trimmed) return res.status(400).json({ error: "name required" });
    const id = randomUUID();
    await run(
      `INSERT INTO workspaces(id, name, description, owner_id)
       VALUES ($1, $2, $3, $4)`,
      [id, trimmed, description ?? null, req.user.id]
    );
    res.json({ id, name: trimmed });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to create workspace" });
  }
});

projectsRouter.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body || {};
    const workspace = await one(
      `SELECT id FROM workspaces WHERE id=$1 AND owner_id=$2`,
      [id, req.user.id]
    );
    if (!workspace) return res.status(404).json({ error: "not found" });

    const nextName = typeof name === "string" ? name.trim() : null;
    await run(
      `UPDATE workspaces
          SET name = COALESCE($1, name),
              description = COALESCE($2, description),
              updated_at = NOW()
        WHERE id=$3`,
      [nextName, description ?? null, id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to update workspace" });
  }
});

projectsRouter.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const workspace = await one(
      `SELECT id FROM workspaces WHERE id=$1 AND owner_id=$2`,
      [id, req.user.id]
    );
    if (!workspace) return res.status(404).json({ error: "not found" });
    await run(`DELETE FROM workspaces WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || "failed to delete workspace" });
  }
});
