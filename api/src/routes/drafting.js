import { Router } from 'express';
export const draftingRouter = Router();

draftingRouter.post('/generate', async (req, res) => {
  const { prompt = '' } = req.body || {};
  const draft_text = `IN THE HIGH COURT OF …\n\nFacts:\n${prompt}\n\nReliefs Sought:\n1) …\n2) …\n\nCitations: SC 2021 SCC OnLine SC 123; Del HC 2019 DLT 56`;
  res.json({ draft_text, versionId: 'v1' });
});
