import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { runEvaluation } from "@/lib/rag.functions";
import { benchmarkQuery, documentsQuery, evalRunsQuery } from "@/lib/rag-queries";
import { MODE_LABELS, type EvalItem, type EvalMetrics, type RetrievalMode } from "@/lib/rag/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/evaluation")({
  head: () => ({
    meta: [
      { title: "Evaluation — RAGStudio" },
      {
        name: "description",
        content:
          "Measure retrieval and citation quality with Precision@K, Recall@K, MRR, nDCG and citation metrics.",
      },
      { property: "og:title", content: "Evaluation — RAGStudio" },
      {
        property: "og:description",
        content: "Run a real benchmark over your indexed documents and compare retrieval modes.",
      },
    ],
  }),
  component: Evaluation,
});

type Metrics = EvalMetrics;
type PerItem = EvalItem;

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="metric-value mt-1.5 text-xl">{value}</p>
    </div>
  );
}

function Evaluation() {
  const queryClient = useQueryClient();
  const docs = useQuery(documentsQuery);
  const benchmark = useQuery(benchmarkQuery);
  const runs = useQuery(evalRunsQuery);
  const run = useServerFn(runEvaluation);

  const [mode, setMode] = useState<RetrievalMode>("hybrid_rerank");
  const [topK, setTopK] = useState(5);
  const [question, setQuestion] = useState("");
  const [expectedDocs, setExpectedDocs] = useState<string[]>([]);
  const [result, setResult] = useState<{ metrics: Metrics; perItem: PerItem[] } | null>(null);

  const indexed = (docs.data ?? []).filter((d) => d.status === "indexed");

  const addItem = useMutation({
    mutationFn: async () => {
      if (question.trim().length < 5) throw new Error("Enter a benchmark question.");
      if (expectedDocs.length === 0) throw new Error("Select at least one expected document.");
      await addBenchmark({
        data: { question: question.trim(), expectedDocumentIds: expectedDocs },
      });
    },
    onSuccess: () => {
      setQuestion("");
      setExpectedDocs([]);
      queryClient.invalidateQueries({ queryKey: ["benchmark"] });
      toast.success("Benchmark question added.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      await removeBenchmark({ data: { id } });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["benchmark"] }),
    onError: (error: Error) => toast.error(error.message),
  });

  const evaluate = useMutation({
    mutationFn: () =>
      run({ data: { mode, topK } }) as Promise<{ metrics: Metrics; perItem: PerItem[] }>,
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["eval_runs"] });
      toast.success("Evaluation complete.");
    },
    onError: (error: Error) => toast.error(error.message || "Evaluation failed."),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Evaluation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every metric below is computed by actually running the selected retrieval pipeline over
          your benchmark questions.
        </p>
      </div>

      <section className="panel p-5">
        <h2 className="text-lg font-semibold">Benchmark dataset</h2>
        <div className="mt-4 space-y-3">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Benchmark question"
            className="bg-surface"
          />
          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Expected relevant documents
            </p>
            {indexed.length === 0 ? (
              <p className="text-sm text-muted-foreground">Index a document first.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {indexed.map((doc) => (
                  <label
                    key={doc.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={expectedDocs.includes(doc.id)}
                      onCheckedChange={(checked) =>
                        setExpectedDocs((prev) =>
                          checked ? [...prev, doc.id] : prev.filter((id) => id !== doc.id),
                        )
                      }
                    />
                    {doc.filename}
                  </label>
                ))}
              </div>
            )}
          </div>
          <Button onClick={() => addItem.mutate()} disabled={addItem.isPending}>
            Add benchmark question
          </Button>
        </div>

        <div className="mt-5 divide-y divide-border rounded-md border border-border">
          {(benchmark.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No benchmark questions yet.</p>
          ) : (
            (benchmark.data ?? []).map((item) => (
              <div key={item.id} className="flex items-center gap-3 p-3">
                <p className="flex-1 text-sm">{item.question}</p>
                <span className="font-mono text-xs text-muted-foreground">
                  {(item.expected_document_ids ?? []).length} expected doc(s)
                </span>
                <Button variant="ghost" size="icon" onClick={() => removeItem.mutate(item.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="panel p-5">
        <div className="flex flex-wrap items-center gap-3">
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
              {[3, 5, 8, 10].map((k) => (
                <SelectItem key={k} value={String(k)}>
                  K = {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => evaluate.mutate()} disabled={evaluate.isPending} className="gap-2">
            {evaluate.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            Run evaluation
          </Button>
        </div>

        {result ? (
          <div className="mt-5 space-y-5">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Retrieval metrics
              </h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label={`Precision@${topK}`} value={pct(result.metrics.precisionAtK)} />
                <MetricCard label={`Recall@${topK}`} value={pct(result.metrics.recallAtK)} />
                <MetricCard label={`F1@${topK}`} value={pct(result.metrics.f1AtK)} />
                <MetricCard label={`Hit Rate@${topK}`} value={pct(result.metrics.hitRateAtK)} />
                <MetricCard label="MRR" value={result.metrics.mrr.toFixed(3)} />
                <MetricCard
                  label="Reciprocal Rank (avg)"
                  value={result.metrics.reciprocalRank.toFixed(3)}
                />
                <MetricCard label={`nDCG@${topK}`} value={result.metrics.ndcgAtK.toFixed(3)} />
                <MetricCard label="Items evaluated" value={String(result.metrics.items)} />
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Citation metrics
              </h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="Citation validity" value={pct(result.metrics.citationValidity)} />
                <MetricCard
                  label="Citation precision"
                  value={pct(result.metrics.citationPrecision)}
                />
                <MetricCard label="Citation recall" value={pct(result.metrics.citationRecall)} />
                <MetricCard label="Citation F1" value={pct(result.metrics.citationF1)} />
              </div>
            </div>
            <div className="space-y-3">
              {result.perItem.map((item) => (
                <div key={item.question} className="rounded-md bg-surface p-4">
                  <p className="text-sm font-medium">{item.question}</p>
                  <p className="mt-1 font-mono text-xs text-primary">
                    P {item.precision.toFixed(2)} · R {item.recall.toFixed(2)} · F1{" "}
                    {item.f1.toFixed(2)} · RR {item.rr.toFixed(2)} · nDCG {item.ndcg.toFixed(2)} ·
                    cit-F1 {item.citationF1.toFixed(2)}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{item.answer}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No evaluation has been run in this session yet.
          </p>
        )}
      </section>

      {(runs.data ?? []).length > 0 ? (
        <section className="panel p-5">
          <h2 className="text-lg font-semibold">Past runs</h2>
          <div className="mt-3 divide-y divide-border">
            {(runs.data ?? []).map((item) => {
              const metrics = item.metrics as Metrics;
              return (
                <div key={item.id} className="flex flex-wrap gap-3 py-2 text-xs">
                  <span className="font-medium">{MODE_LABELS[item.mode as RetrievalMode]}</span>
                  <span className="font-mono text-muted-foreground">K={item.top_k}</span>
                  <span className="font-mono text-primary">
                    P {pct(metrics.precisionAtK)} · MRR {metrics.mrr.toFixed(3)} ·
                    cit-F1 {pct(metrics.citationF1)}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(item.created_at).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
