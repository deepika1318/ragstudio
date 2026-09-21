import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { embedTexts, generateJson } from "./ai.server";
import { bm25Search, rrfFuse } from "./bm25.server";

export type RetrievalMode = "vector" | "hybrid" | "hybrid_rerank";

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

const CANDIDATES = 30;

type ChunkRow = {
  id: string;
  document_id: string;
  chunk_index: number;
  page: number | null;
  content: string;
};

export class RetrievalError extends Error {}

async function loadCorpus() {
  const { data, error } = await supabaseAdmin
    .from("chunks")
    .select("id, document_id, chunk_index, page, content")
    .limit(20000);
  if (error) throw new RetrievalError(`Could not read the document index: ${error.message}`);
  return (data ?? []) as ChunkRow[];
}

async function documentNames(ids: string[]) {
  const { data, error } = await supabaseAdmin
    .from("documents")
    .select("id, filename")
    .in("id", ids);
  if (error) throw new RetrievalError(`Could not read document metadata: ${error.message}`);
  return new Map((data ?? []).map((d) => [d.id, d.filename]));
}

/** LLM cross-encoder reranker: scores every (query, passage) pair jointly. */
async function rerank(
  question: string,
  candidates: { chunk_id: string; content: string }[],
): Promise<Map<string, number>> {
  const numbered = candidates
    .map((c, i) => `[${i + 1}] ${c.content.slice(0, 1200)}`)
    .join("\n\n---\n\n");
  const result = await generateJson<{ scores: { index: number; relevance: number }[] }>(
    `Query: ${question}\n\nPassages:\n\n${numbered}`,
    "rerank_scores",
    {
      type: "object",
      additionalProperties: false,
      required: ["scores"],
      properties: {
        scores: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["index", "relevance"],
            properties: {
              index: { type: "integer" },
              relevance: { type: "number" },
            },
          },
        },
      },
    },
    "You are a cross-encoder reranker. For each numbered passage, judge how well it answers the query. Return a relevance score between 0 and 1 for every passage index, based only on the passage text.",
  );
  const map = new Map<string, number>();
  for (const item of result.scores ?? []) {
    const candidate = candidates[item.index - 1];
    if (candidate) map.set(candidate.chunk_id, Math.max(0, Math.min(1, item.relevance)));
  }
  return map;
}

export async function retrieve(
  question: string,
  mode: RetrievalMode,
  topK: number,
): Promise<RetrievedChunk[]> {
  const corpus = await loadCorpus();
  if (corpus.length === 0) {
    throw new RetrievalError("No documents are indexed yet. Upload a document first.");
  }
  const byId = new Map(corpus.map((c) => [c.id, c]));

  const [queryEmbedding] = await embedTexts([question]);
  const { data: vectorData, error: vectorError } = await supabaseAdmin.rpc("match_chunks", {
    query_embedding: queryEmbedding as unknown as string,
    match_count: CANDIDATES,
  });
  if (vectorError) throw new RetrievalError(`Vector search failed: ${vectorError.message}`);
  const vectorHits = (vectorData ?? []) as { id: string; similarity: number }[];
  const vectorScores = new Map(vectorHits.map((h) => [h.id, h.similarity]));

  let orderedIds: string[];
  let fusedScores = new Map<string, number>();
  let bm25Scores = new Map<string, number>();
  let method = "vector";

  if (mode === "vector") {
    orderedIds = vectorHits.map((h) => h.id).slice(0, topK);
    fusedScores = vectorScores;
  } else {
    const bm25Hits = bm25Search(corpus, question, CANDIDATES);
    bm25Scores = new Map(bm25Hits.map((h) => [h.id, h.score]));
    fusedScores = rrfFuse([vectorHits.map((h) => h.id), bm25Hits.map((h) => h.id)]);
    orderedIds = [...fusedScores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    method = "hybrid_rrf";
  }

  let rerankScores = new Map<string, number>();
  if (mode === "hybrid_rerank") {
    const candidates = orderedIds
      .slice(0, Math.max(topK * 3, 12))
      .map((id) => ({ chunk_id: id, content: byId.get(id)?.content ?? "" }))
      .filter((c) => c.content);
    rerankScores = await rerank(question, candidates);
    orderedIds = candidates
      .map((c) => c.chunk_id)
      .sort((a, b) => (rerankScores.get(b) ?? 0) - (rerankScores.get(a) ?? 0));
    method = "hybrid_rrf + cross-encoder rerank";
  }

  const finalIds = orderedIds.slice(0, topK).filter((id) => byId.has(id));
  const names = await documentNames([...new Set(finalIds.map((id) => byId.get(id)!.document_id))]);

  return finalIds.map((id, i) => {
    const chunk = byId.get(id)!;
    const primaryScore =
      mode === "hybrid_rerank"
        ? (rerankScores.get(id) ?? 0)
        : (fusedScores.get(id) ?? 0);
    return {
      rank: i + 1,
      chunk_id: id,
      document_id: chunk.document_id,
      document_name: names.get(chunk.document_id) ?? "Unknown document",
      page: chunk.page,
      chunk_index: chunk.chunk_index,
      content: chunk.content,
      score: Number(primaryScore.toFixed(6)),
      method,
      vector_score: vectorScores.has(id) ? Number(vectorScores.get(id)!.toFixed(6)) : null,
      bm25_score: bm25Scores.has(id) ? Number(bm25Scores.get(id)!.toFixed(4)) : null,
      rerank_score: rerankScores.has(id) ? Number(rerankScores.get(id)!.toFixed(4)) : null,
    };
  });
}

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

export type AnswerResult = {
  answer: string;
  insufficient: boolean;
  citations: Citation[];
};

export async function generateAnswer(
  question: string,
  context: RetrievedChunk[],
): Promise<AnswerResult> {
  const contextBlock = context
    .map(
      (c) =>
        `[${c.rank}] document="${c.document_name}" page=${c.page ?? "n/a"} chunk_id=${c.chunk_id}\n${c.content}`,
    )
    .join("\n\n---\n\n");

  const result = await generateJson<{
    answer: string;
    insufficient_evidence: boolean;
    citations: { ref: number }[];
  }>(
    `Question: ${question}\n\nRetrieved context:\n\n${contextBlock}`,
    "grounded_answer",
    {
      type: "object",
      additionalProperties: false,
      required: ["answer", "insufficient_evidence", "citations"],
      properties: {
        answer: { type: "string" },
        insufficient_evidence: { type: "boolean" },
        citations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["ref"],
            properties: { ref: { type: "integer" } },
          },
        },
      },
    },
    "You answer strictly from the retrieved context passages. Never use outside knowledge. Write the answer as plain prose with no markdown formatting (no **bold**, headings, or bullet markers). Cite supporting passages by their bracket number in the `citations` array and reference them inline as [1], [2] in the answer. If the context does not support an answer, set insufficient_evidence to true, return an empty citations array, and say the answer could not be determined from the indexed documents.",
  );

  const byRank = new Map(context.map((c) => [c.rank, c]));
  const citations: Citation[] = [];
  for (const item of result.citations ?? []) {
    const chunk = byRank.get(item.ref);
    if (!chunk || citations.some((c) => c.chunk_id === chunk.chunk_id)) continue;
    citations.push({
      ref: chunk.rank,
      chunk_id: chunk.chunk_id,
      document_id: chunk.document_id,
      document_name: chunk.document_name,
      page: chunk.page,
      chunk_index: chunk.chunk_index,
      passage: chunk.content.slice(0, 600),
      score: chunk.score,
      rerank_score: chunk.rerank_score,
    });
  }

  return {
    answer: result.answer,
    insufficient: Boolean(result.insufficient_evidence) || citations.length === 0,
    citations,
  };
}
