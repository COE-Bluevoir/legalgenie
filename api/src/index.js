import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

import { authRouter } from './routes/auth.js';
import { authRequired, adminOnly } from './middleware/auth.js';
import { vectorRouter } from './routes/vector.js';
import { researchRouter } from './routes/research.js';
import { contractsRouter } from './routes/contracts.js';
import { draftingRouter } from './routes/drafting.js';
import { litigationRouter } from './routes/litigation.js';
import { complianceRouter } from './routes/compliance.js';
import { projectsRouter } from './routes/projects.js';
import { threadsRouter } from './routes/threads.js';
import { uploadsRouter } from './routes/uploads.js';
import { ingestionRouter } from './routes/ingestion.js';
import { briefRouter } from './routes/brief.js';
import { messagesRouter } from './routes/messages.js';
import { adminRouter } from './routes/admin.js';
import { ragRouter } from './routes/rag.js';

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

app.use('/api/auth', authRouter);

// Friendly root route (avoids 'Cannot GET /')
app.get('/', (_req, res) => {
  res
    .type('text/plain')
    .send(
      'LegalGenie API online. See /api/health. Persistent endpoints: /api/projects /api/threads /api/uploads /api/brief /api/messages. Legacy demo: /api/research/*'
    );
});
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Require auth for everything below
app.use(authRequired);

app.use('/api/admin', adminOnly, adminRouter);
app.use('/api/vector', vectorRouter);
app.use('/api/research', researchRouter);
app.use('/api/contracts', contractsRouter);
app.use('/api/drafting', draftingRouter);
app.use('/api/litigation', litigationRouter);
app.use('/api/compliance', complianceRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/threads', threadsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/brief', briefRouter);
app.use('/api/messages', messagesRouter);
app.use('/api/rag', ragRouter);
// Alias route for hybrid RAG
app.use('/api/hybrid-rag', ragRouter);

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`LegalGenie API -> http://localhost:${port}`));


