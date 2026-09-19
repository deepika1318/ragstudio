/** Real BM25 (Okapi, k1=1.5, b=0.75) over the indexed chunk corpus. */

const STOPWORDS = new Set(
  "a an and are as at be by for from has have in is it its of on or that the to was were will with this these those we you your our their they he she i".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length > 1 && !STOPWORDS.has(t),
  );
}

export type Bm25Doc = { id: string; content: string };
export type Bm25Hit = { id: string; score: number };

const K1 = 1.5;
const B = 0.75;

export function bm25Search(corpus: Bm25Doc[], query: string, topK: number): Bm25Hit[] {
  if (corpus.length === 0) return [];
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];

  const termFreqs: Map<string, number>[] = [];
  const lengths: number[] = [];
  const docFreq = new Map<string, number>();

  for (const doc of corpus) {
    const tokens = tokenize(doc.content);
    lengths.push(tokens.length);
    const tf = new Map<string, number>();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    termFreqs.push(tf);
    for (const term of tf.keys()) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
  }

  const N = corpus.length;
  const avgLen = lengths.reduce((a, b) => a + b, 0) / N || 1;

  const scored: Bm25Hit[] = corpus.map((doc, i) => {
    let score = 0;
    for (const term of queryTerms) {
      const f = termFreqs[i].get(term);
      if (!f) continue;
      const n = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * lengths[i]) / avgLen)));
    }
    return { id: doc.id, score };
  });

  return scored
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Reciprocal Rank Fusion. */
export function rrfFuse(rankings: string[][], k = 60): Map<string, number> {
  const fused = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, index) => {
      fused.set(id, (fused.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return fused;
}
