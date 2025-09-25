import { Router } from 'express';
export const litigationRouter = Router();

litigationRouter.post('/insights', async (req, res) => {
  const strategies = [
    { title: 'Primary Strategy', text: 'File under writ; seek interim relief citing urgency.', confidence: 'High', cites: 'SC 2020, Del HC 2019' },
    { title: 'Fallback Strategy', text: 'Invoke arbitration; seek S.9 interim protection.', confidence: 'Medium', cites: 'Bom HC 2018' }
  ];
  const timeline = [
    { day: 'Day 0', events: 2 }, { day: 'Day 7', events: 5 },
    { day: 'Day 14', events: 8 }, { day: 'Day 21', events: 10 }, { day: 'Day 30', events: 13 }
  ];
  const counsel_stats = [
    { name: 'R. Mehta', win: 58 }, { name: 'S. Iyer', win: 46 }, { name: 'A. Khan', win: 51 }
  ];
  res.json({ strategies, timeline, settlement_probability: 64, counsel_stats });
});
