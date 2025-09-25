const storeName = (process.env.VECTOR_STORE || 'memory').toLowerCase();

let adapter;
if (storeName === 'chroma') {
  ({ adapter } = await import('./providers/chroma.js'));
} else {
  ({ adapter } = await import('./providers/memory.js'));
}

export const vector = adapter;
