import { Router } from 'express';
export const complianceRouter = Router();

complianceRouter.get('/status', (_req, res) => {
  const statuses = [
    { title: 'DPDP Act, 2023', status: 'Attention', pct: 62 },
    { title: 'IT Act, 2000', status: 'Compliant', pct: 91 },
    { title: 'Companies Act, 2013', status: 'On Track', pct: 78 }
  ];
  const updates = [
    { date: '18 Aug 2025', text: 'CERT-In advisory on breach reporting timelines.' },
    { date: '12 Aug 2025', text: 'SEBI updates on disclosure norms.' },
    { date: '05 Aug 2025', text: 'RBI circular on KYC periodicity changes.' }
  ];
  const audit = [
    { text: 'Signed DPA v1.2', time: '12:31 IST' },
    { text: 'Updated policy mapping', time: '12:34 IST' },
    { text: 'Acknowledged SEBI update', time: '12:36 IST' },
    { text: 'Exported compliance report', time: '12:39 IST' }
  ];
  res.json({ statuses, updates, audit });
});
