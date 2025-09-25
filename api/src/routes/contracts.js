import { Router } from "express";
import { v4 as uuid } from "uuid";

const router = Router();

router.post("/review", (req, res) => {
  res.json({
    issues: [
      { id: uuid(), title: "Indemnity too broad", severity: "high" },
      { id: uuid(), title: "Liability cap missing", severity: "medium" },
    ],
  });
});

router.post("/compare", (req, res) => {
  res.json({
    diffs: [
      { path: "Clause 10.2", change: "modified" },
      { path: "Clause 11.1", change: "added" },
    ],
  });
});

export const contractsRouter = router;
