export const adapter = {
  async search({ query, topK = 10 }) {
    const fake = Array.from({ length: Math.min(topK, 5) }).map((_, i) => ({
      id: `demo-${i+1}`,
      title: `ACME v. State of X — 2021 SCC OnLine SC ${120 + i}`,
      snippet: `Held that indemnity clauses must be construed strictly… (query: ${query})`,
      score: 0.92 - i * 0.05,
      court: 'Supreme Court',
      judge: 'Chandrachud J',
      date: '2021-01-12',
      langs: ['En', 'Hi']
    }));
    return { results: fake, metadata: { source: 'memory' } };
  },
  async upsert() { return { upserted: 0 }; },
  async delete() { return { deleted: 0 }; }
};
