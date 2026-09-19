import type { ExtractedPage } from "./extract.server";

export type Chunk = { chunk_index: number; page: number; content: string; token_estimate: number };

const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 650; // 500-800 token window
const OVERLAP_TOKENS = 100;
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

export function estimateTokens(text: string) {
  return Math.max(1, Math.round(text.length / CHARS_PER_TOKEN));
}

/** Sentence-aware sliding window chunking with ~100 token overlap, per page. */
export function chunkPages(pages: ExtractedPage[]): Chunk[] {
  const chunks: Chunk[] = [];
  let index = 0;

  for (const page of pages) {
    const sentences = page.text.match(/[^.!?\n]+[.!?]?[\n]*/g) ?? [page.text];
    let buffer = "";

    const flush = () => {
      const content = buffer.trim();
      if (content.length < 40) return;
      chunks.push({
        chunk_index: index++,
        page: page.page,
        content,
        token_estimate: estimateTokens(content),
      });
    };

    for (const sentence of sentences) {
      if (buffer.length + sentence.length > TARGET_CHARS && buffer.length > 0) {
        flush();
        buffer = buffer.slice(Math.max(0, buffer.length - OVERLAP_CHARS));
      }
      // Hard split for pathological single "sentences" (tables, code dumps).
      if (sentence.length > TARGET_CHARS) {
        for (let i = 0; i < sentence.length; i += TARGET_CHARS - OVERLAP_CHARS) {
          buffer += sentence.slice(i, i + TARGET_CHARS);
          flush();
          buffer = "";
        }
        continue;
      }
      buffer += sentence;
    }
    flush();
  }

  return chunks.map((c, i) => ({ ...c, chunk_index: i }));
}
