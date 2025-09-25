import fetch from 'node-fetch';
const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000';

export const adapter = {
  async search({ query, topK = 10, filters }) {
    const res = await fetch(`${CHROMA_URL}/api/v1/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, n_results: topK, where: filters || {} })
    });
    if (!res.ok) throw new Error(`Chroma HTTP ${res.status}`);
    const data = await res.json();
    const ids = data.ids || [];
    const docs = data.documents || [];
    const distances = data.distances || [];
    const results = docs.map((doc, i) => ({
      id: ids[i] || `chroma-${i}`,
      title: doc.title || doc.metadata?.title || `Result ${i+1}`,
      snippet: doc.text || doc.page_content || '',
      score: distances.length ? 1 - (distances[i] || 0) : 0.8,
      court: doc.metadata?.court,
      judge: doc.metadata?.judge,
      date: doc.metadata?.date,
      langs: doc.metadata?.langs || ['En']
    }));
    return { results, metadata: { source: 'chroma' } };
  },
  async upsert(rows) { return { upserted: rows?.length || 0 }; },
  async delete({ ids }) { return { deleted: ids?.length || 0 }; }
};
