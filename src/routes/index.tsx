import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ChevronDown, Loader2, Quote, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { askQuestion } from "@/lib/rag.functions";
import { documentsQuery } from "@/lib/rag-queries";
import { MODE_DESCRIPTIONS, MODE_LABELS, type RetrievalMode } from "@/lib/rag/types";
import type { Citation, RetrievedChunk } from "@/lib/rag/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Q&A Workspace — RAGStudio" },
      {
        name: "description",
        content:
          "Ask questions about your indexed documents and get grounded answers with real citations.",
      },
      { property: "og:title", content: "Q&A Workspace — RAGStudio" },
      {
        property: "og:description",
        content: "Hybrid retrieval, cross-encoder reranking, and citation-backed answers.",
      },
    ],
  }),
  component: Workspace,
});

type AskResult = {
  answer: string;
  insufficient: boolean;
  citations: Citation[];
  context: RetrievedChunk[];
  latencyMs: number;
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="metric-value mt-2">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Workspace() {
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<RetrievalMode>("hybrid_rerank");
  const [topK, setTopK] = useState(5);
  const [result, setResult] = useState<AskResult | null>(null);

  const docs = useQuery(documentsQuery);
  const ask = useServerFn(askQuestion);

  const indexed = (docs.data ?? []).filter((d) => d.status === "indexed");
  const totalChunks = indexed.reduce((sum, d) => sum + (d.chunk_count ?? 0), 0);

  const mutation = useMutation({
    mutationFn: (payload: { question: string; mode: RetrievalMode; topK: number }) =>
      ask({ data: payload }) as Promise<AskResult>,
    onSuccess: (data) => setResult(data),
    onError: (error: Error) => toast.error(error.message || "The question could not be answered."),
  });

  const submit = () => {
    const trimmed = question.trim();
    if (trimmed.length < 3) {
      toast.error("Please enter a question first.");
      return;
    }
    if (indexed.length === 0) {
      toast.error("No documents are indexed yet. Upload one in Document Index.");
      return;
    }
    mutation.mutate({ question: trimmed, mode, topK });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Q&A Workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Answers are generated only from passages retrieved out of your indexed documents.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Documents indexed" value={String(indexed.length)} />
        <Stat label="Chunks created" value={String(totalChunks)} />
        <Stat label="Retrieval mode" value={MODE_LABELS[mode]} hint={`Top-K = ${topK}`} />
        <Stat
          label="Results retrieved"
          value={result ? String(result.context.length) : "—"}
          hint={result ? `${result.latencyMs} ms end-to-end` : "Run a query"}
        />
      </div>

      <div className="panel p-5">
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about your indexed documents..."
          rows={3}
          className="resize-none bg-surface text-base"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Select value={mode} onValueChange={(value) => setMode(value as RetrievalMode)}>
            <SelectTrigger className="w-[190px] bg-surface">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODE_LABELS) as RetrievalMode[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {MODE_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(topK)} onValueChange={(value) => setTopK(Number(value))}>
            <SelectTrigger className="w-[130px] bg-surface">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[3, 5, 8, 10, 15].map((k) => (
                <SelectItem key={k} value={String(k)}>
                  Top-K {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={submit} disabled={mutation.isPending} className="gap-2">
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            {mutation.isPending ? "Retrieving & generating..." : "Ask"}
          </Button>
          <p className="text-xs text-muted-foreground">{MODE_DESCRIPTIONS[mode]}</p>
        </div>
      </div>

      {mutation.isPending ? (
        <div className="panel flex items-center gap-3 p-5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" />
          Embedding query, retrieving passages, and grounding the answer...
        </div>
      ) : null}

      {result ? (
        <div className="space-y-6">
          <section className="panel p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Answer</h2>
              {result.insufficient ? (
                <Badge variant="outline" className="gap-1 border-warning text-warning">
                  <TriangleAlert className="size-3" /> Insufficient evidence
                </Badge>
              ) : (
                <Badge variant="outline" className="border-success text-success">
                  {result.citations.length} citation{result.citations.length === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{result.answer}</p>
          </section>

          <section className="panel p-5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Quote className="size-4 text-primary" /> Sources
            </h2>
            {result.citations.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No passage in the index supported this answer, so no citations were produced.
              </p>
            ) : (
              <ol className="mt-4 space-y-4">
                {result.citations.map((citation) => (
                  <li key={citation.chunk_id} className="border-l-2 border-primary/60 pl-4">
                    <p className="text-sm font-medium">
                      <span className="text-primary">[{citation.ref}]</span>{" "}
                      {citation.document_name}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {citation.page ? `Page ${citation.page} · ` : ""}chunk #{citation.chunk_index}{" "}
                      · score {citation.score}
                      {citation.rerank_score !== null
                        ? ` · reranker ${citation.rerank_score}`
                        : ""}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">{citation.passage}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <Collapsible className="panel">
            <CollapsibleTrigger className="group flex w-full items-center justify-between p-5 text-left">
              <span className="text-lg font-semibold">
                Retrieved Context ({result.context.length})
              </span>
              <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 border-t border-border p-5">
              {result.context.map((chunk) => (
                <div key={chunk.chunk_id} className="rounded-md bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="secondary" className="font-mono">
                      rank {chunk.rank}
                    </Badge>
                    <span className="font-medium">{chunk.document_name}</span>
                    <span className="font-mono text-muted-foreground">
                      {chunk.page ? `page ${chunk.page} · ` : ""}chunk #{chunk.chunk_index}
                    </span>
                    <span className="font-mono text-muted-foreground">{chunk.method}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 font-mono text-xs text-primary">
                    <span>score {chunk.score}</span>
                    {chunk.vector_score !== null ? <span>vector {chunk.vector_score}</span> : null}
                    {chunk.bm25_score !== null ? <span>bm25 {chunk.bm25_score}</span> : null}
                    {chunk.rerank_score !== null ? (
                      <span>reranker {chunk.rerank_score}</span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {chunk.content}
                  </p>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </div>
      ) : null}
    </div>
  );
}
