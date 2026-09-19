export type RetrievalMode = "vector" | "hybrid" | "hybrid_rerank";

export const MODE_LABELS: Record<RetrievalMode, string> = {
  vector: "Vector",
  hybrid: "Hybrid RRF",
  hybrid_rerank: "Hybrid + Rerank",
};

export const MODE_DESCRIPTIONS: Record<RetrievalMode, string> = {
  vector: "Dense embedding similarity search (pgvector, cosine).",
  hybrid: "BM25 keyword + vector search fused with Reciprocal Rank Fusion.",
  hybrid_rerank: "Hybrid RRF candidates re-scored by a cross-encoder reranker.",
};

export type RetrievedChunk = {
  rank: number;
  chunk_id: string;
  document_id: string;
  document_name: string;
  page: number | null;
  chunk_index: number;
  content: string;
  score: number;
  method: string;
  vector_score: number | null;
  bm25_score: number | null;
  rerank_score: number | null;
};

export type Citation = {
  ref: number;
  chunk_id: string;
  document_id: string;
  document_name: string;
  page: number | null;
  chunk_index: number;
  passage: string;
  score: number;
  rerank_score: number | null;
};
