import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown } from "lucide-react";

import { documentsQuery } from "@/lib/rag-queries";

export const Route = createFileRoute("/pipeline")({
  head: () => ({
    meta: [
      { title: "Pipeline — RAGStudio" },
      {
        name: "description",
        content: "The full citation-aware hybrid RAG pipeline, stage by stage.",
      },
      { property: "og:title", content: "Pipeline — RAGStudio" },
      {
        property: "og:description",
        content: "Extraction, chunking, embeddings, BM25, RRF, reranking, answer, evaluation.",
      },
    ],
  }),
  component: Pipeline,
});

const STAGES = [
  { name: "Documents", detail: "PDF / DOCX / TXT upload, max 50 MB, metadata preserved" },
  { name: "Text Extraction", detail: "Per-page text extraction with page numbers where available" },
  { name: "Chunking", detail: "~650-token windows with ~100-token overlap, sentence aware" },
  { name: "Embeddings", detail: "1536-dim embeddings stored in pgvector (HNSW, cosine)" },
  { name: "Vector Search", detail: "Semantic top-N candidate retrieval" },
  { name: "BM25 Search", detail: "Okapi BM25 (k1=1.5, b=0.75) over the chunk corpus" },
  { name: "Hybrid RRF", detail: "Reciprocal Rank Fusion, k=60, over both rankings" },
  { name: "Cross-Encoder Reranking", detail: "Joint query-passage scoring of fused candidates" },
  { name: "LLM", detail: "Grounded generation constrained to retrieved passages only" },
  { name: "Answer + Citations", detail: "Citations validated against retrieved chunk IDs" },
  { name: "Evaluation", detail: "Retrieval and citation metrics over a benchmark set" },
];

function Pipeline() {
  const docs = useQuery(documentsQuery);
  const indexed = (docs.data ?? []).filter((d) => d.status === "indexed");
  const chunks = indexed.reduce((sum, d) => sum + (d.chunk_count ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live index: {indexed.length} document(s), {chunks} chunk(s).
        </p>
      </div>

      <div className="panel p-6">
        <ol className="mx-auto flex max-w-2xl flex-col items-stretch">
          {STAGES.map((stage, i) => (
            <li key={stage.name}>
              <div className="rounded-md border border-border bg-surface px-4 py-3">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span className="font-mono text-xs text-primary">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {stage.name}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{stage.detail}</p>
              </div>
              {i < STAGES.length - 1 ? (
                <div className="flex justify-center py-1.5">
                  <ArrowDown className="size-4 text-primary/60" />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
