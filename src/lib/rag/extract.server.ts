import { unzipSync, strFromU8 } from "fflate";

export type ExtractedPage = { page: number; text: string };

export class ExtractionError extends Error {}

function cleanText(text: string) {
  return text.replace(/\r/g, "\n").replace(/\u0000/g, "").replace(/[ \t]+/g, " ").trim();
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractedPage[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [String(text)]) as string[];
  return pages
    .map((t, i) => ({ page: i + 1, text: cleanText(t) }))
    .filter((p) => p.text.length > 0);
}

function extractDocx(bytes: Uint8Array): ExtractedPage[] {
  const files = unzipSync(bytes);
  const doc = files["word/document.xml"];
  if (!doc) throw new ExtractionError("This DOCX file has no readable document body.");
  const xml = strFromU8(doc);
  const paragraphs = xml.split(/<\/w:p>/).map((block) => {
    const runs = [...block.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
    return runs
      .join("")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  });
  const text = cleanText(paragraphs.filter(Boolean).join("\n"));
  if (!text) throw new ExtractionError("No text could be extracted from this DOCX file.");
  return [{ page: 1, text }];
}

function extractTxt(bytes: Uint8Array): ExtractedPage[] {
  const text = cleanText(new TextDecoder().decode(bytes));
  if (!text) throw new ExtractionError("This text file is empty.");
  return [{ page: 1, text }];
}

export async function extractDocument(
  bytes: Uint8Array,
  filename: string,
): Promise<ExtractedPage[]> {
  const lower = filename.toLowerCase();
  let pages: ExtractedPage[];
  try {
    if (lower.endsWith(".pdf")) pages = await extractPdf(bytes);
    else if (lower.endsWith(".docx")) pages = extractDocx(bytes);
    else if (lower.endsWith(".txt") || lower.endsWith(".md")) pages = extractTxt(bytes);
    else throw new ExtractionError("Unsupported file type. Upload a PDF, DOCX, or TXT file.");
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError(
      `Text extraction failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  const total = pages.reduce((sum, p) => sum + p.text.length, 0);
  if (total < 20) {
    throw new ExtractionError(
      "No readable text found in this document (it may be a scanned image-only file).",
    );
  }
  return pages;
}
