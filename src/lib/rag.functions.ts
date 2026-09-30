import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { EvalItem, EvalMetrics } from "./rag/types";

const IngestInput = z.object({
  filename: z.string().min(1),
  fileType: z.string().default(""),
  fileSize: z.number().int().nonnegative(),
  contentBase64: z.string().min(1),
});

const AskInput = z.object({
  question: z.string().min(3),
  mode: z.enum(["vector", "hybrid", "hybrid_rerank"]),
  topK: z.number().int().min(1).max(20),
});

const EvalInput = z.object({
  mode: z.enum(["vector", "hybrid", "hybrid_rerank"]),
  topK: z.number().int().min(1).max(20),
});

function base64ToBytes(b64: string) {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error.";
}

/** Stage 1-3: extract -> chunk -> embed -> index. */
export const ingestDocument = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => IngestInput.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { extractDocument } = await import("./rag/extract.server");
    const { chunkPages } = await import("./rag/chunk.server");
    const { embedTexts } = await import("./rag/ai.server");

    const bytes = base64ToBytes(data.contentBase64);
    if (bytes.byteLength > 50 * 1024 * 1024) {
      throw new Error("File is larger than the 50 MB limit.");
    }

    const { data: doc, error: insertError } = await supabaseAdmin
      .from("documents")
      .insert({
        filename: data.filename,
        file_type: data.fileType || data.filename.split(".").pop() || "unknown",
        file_size: data.fileSize,
        status: "processing",
      })
      .select()
      .single();
    if (insertError || !doc) throw new Error(`Could not register document: ${insertError?.message}`);

    const fail = async (status: string, error: string) => {
      await supabaseAdmin.from("documents").update({ status, error }).eq("id", doc.id);
      throw new Error(error);
    };

    let pages;
    try {
      pages = await extractDocument(bytes, data.filename);
    } catch (error) {
      return fail("extraction_failed", message(error));
    }

    const chunks = chunkPages(pages);
    if (chunks.length === 0) return fail("chunking_failed", "No usable text chunks were produced.");

    let embeddings: number[][];
    try {
      embeddings = await embedTexts(chunks.map((c) => c.content));
    } catch (error) {
      return fail("embedding_failed", message(error));
    }

    const rows = chunks.map((chunk, i) => ({
      document_id: doc.id,
      chunk_index: chunk.chunk_index,
      page: chunk.page,
      content: chunk.content,
      token_estimate: chunk.token_estimate,
      embedding: JSON.stringify(embeddings[i]),
    }));

    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabaseAdmin.from("chunks").insert(rows.slice(i, i + 100));
      if (error) return fail("indexing_failed", `Indexing failed: ${error.message}`);
    }

    await supabaseAdmin
      .from("documents")
      .update({
        status: "indexed",
        page_count: pages.length,
        chunk_count: chunks.length,
        char_count: pages.reduce((sum, p) => sum + p.text.length, 0),
        error: null,
      })
      .eq("id", doc.id);

    return { documentId: doc.id, chunks: chunks.length, pages: pages.length };
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("documents").delete().eq("id", data.id);
    if (error) throw new Error(`Could not delete document: ${error.message}`);
    return { ok: true };
  });

export const addBenchmarkItem = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        question: z.string().min(5).max(2000),
        expectedDocumentIds: z.array(z.string().uuid()).min(1).max(50),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("benchmark_items").insert({
      question: data.question,
      expected_document_ids: data.expectedDocumentIds,
    });
    if (error) throw new Error(`Could not add benchmark question: ${error.message}`);
    return { ok: true };
  });

export const deleteBenchmarkItem = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("benchmark_items").delete().eq("id", data.id);
    if (error) throw new Error(`Could not remove benchmark question: ${error.message}`);
    return { ok: true };
  });

/** Stages 4-6: retrieve -> (fuse -> rerank) -> answer with citations. */
export const askQuestion = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => AskInput.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { retrieve, generateAnswer } = await import("./rag/retrieve.server");

    const started = Date.now();
    const context = await retrieve(data.question, data.mode, data.topK);
    if (context.length === 0) {
      throw new Error("Retrieval returned no passages for this question.");
    }
    const answer = await generateAnswer(data.question, context);
    const latency = Date.now() - started;

    await supabaseAdmin.from("queries").insert({
      question: data.question,
      mode: data.mode,
      top_k: data.topK,
      answer: answer.answer,
      insufficient: answer.insufficient,
      results: context as unknown as never,
      citations: answer.citations as unknown as never,
      latency_ms: latency,
    });

    return { ...answer, context, latencyMs: latency };
  });

/** Real retrieval + citation evaluation over the saved benchmark set. */
export const runEvaluation = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => EvalInput.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { retrieve, generateAnswer } = await import("./rag/retrieve.server");

    const { data: items, error } = await supabaseAdmin
      .from("benchmark_items")
      .select("*")
      .order("created_at");
    if (error) throw new Error(`Could not load benchmark: ${error.message}`);
    if (!items || items.length === 0) {
      throw new Error("Add at least one benchmark question before running evaluation.");
    }

    const k = data.topK;
    const perItem: (EvalItem & {
      retrieved: { document: string; page: number | null; score: number; relevant: boolean }[];
    })[] = [];

    for (const item of items) {
      const expected = new Set(item.expected_document_ids ?? []);
      const context = await retrieve(item.question, data.mode, k);
      const retrievedDocs = context.map((c) => c.document_id);

      const relevantFlags = retrievedDocs.map((id) => expected.has(id));
      const hits = relevantFlags.filter(Boolean).length;
      const precision = context.length ? hits / context.length : 0;
      const recall = expected.size
        ? new Set(retrievedDocs.filter((id) => expected.has(id))).size / expected.size
        : 0;
      const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
      const firstRelevant = relevantFlags.findIndex(Boolean);
      const rr = firstRelevant === -1 ? 0 : 1 / (firstRelevant + 1);
      const dcg = relevantFlags.reduce(
        (sum, rel, i) => sum + (rel ? 1 / Math.log2(i + 2) : 0),
        0,
      );
      const idealCount = Math.min(expected.size, k);
      const idcg = Array.from({ length: idealCount }).reduce<number>(
        (sum, _, i) => sum + 1 / Math.log2(i + 2),
        0,
      );
      const ndcg = idcg ? dcg / idcg : 0;

      const answer = await generateAnswer(item.question, context);
      const retrievedChunkIds = new Set(context.map((c) => c.chunk_id));
      const validCitations = answer.citations.filter((c) => retrievedChunkIds.has(c.chunk_id));
      const citationValidity = answer.citations.length
        ? validCitations.length / answer.citations.length
        : 0;
      const citedDocs = new Set(validCitations.map((c) => c.document_id));
      const correctCited = [...citedDocs].filter((id) => expected.has(id)).length;
      const citationPrecision = citedDocs.size ? correctCited / citedDocs.size : 0;
      const citationRecall = expected.size ? correctCited / expected.size : 0;
      const citationF1 =
        citationPrecision + citationRecall
          ? (2 * citationPrecision * citationRecall) / (citationPrecision + citationRecall)
          : 0;

      perItem.push({
        question: item.question,
        retrieved: context.map((c) => ({
          document: c.document_name,
          page: c.page,
          score: c.score,
          relevant: expected.has(c.document_id),
        })),
        precision,
        recall,
        f1,
        hit: hits > 0 ? 1 : 0,
        rr,
        ndcg,
        citationValidity,
        citationPrecision,
        citationRecall,
        citationF1,
        answer: answer.answer,
        insufficient: answer.insufficient,
      });
    }

    const avg = (key: keyof EvalItem) =>
      perItem.reduce((sum, item) => sum + (item[key] as number), 0) / perItem.length;

    const metrics: EvalMetrics = {
      k,
      items: perItem.length,
      precisionAtK: avg("precision"),
      recallAtK: avg("recall"),
      f1AtK: avg("f1"),
      hitRateAtK: avg("hit"),
      mrr: avg("rr"),
      reciprocalRank: avg("rr"),
      ndcgAtK: avg("ndcg"),
      citationValidity: avg("citationValidity"),
      citationPrecision: avg("citationPrecision"),
      citationRecall: avg("citationRecall"),
      citationF1: avg("citationF1"),
    };

    await supabaseAdmin.from("eval_runs").insert({
      mode: data.mode,
      top_k: k,
      metrics: metrics as unknown as never,
      per_item: perItem as unknown as never,
    });

    return { metrics, perItem };
  });
