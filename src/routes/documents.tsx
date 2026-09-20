import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { FileText, Loader2, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { deleteDocument, ingestDocument } from "@/lib/rag.functions";
import { documentsQuery } from "@/lib/rag-queries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [
      { title: "Document Index — RAGStudio" },
      {
        name: "description",
        content: "Upload PDF, DOCX, and TXT files and watch them get chunked, embedded, indexed.",
      },
      { property: "og:title", content: "Document Index — RAGStudio" },
      {
        property: "og:description",
        content: "Real document ingestion: extraction, chunking, embeddings, vector indexing.",
      },
    ],
  }),
  component: Documents,
});

const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED = [".pdf", ".txt", ".docx", ".md"];

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function statusBadge(status: string) {
  if (status === "indexed")
    return <Badge className="bg-success/15 text-success hover:bg-success/15">Indexed</Badge>;
  if (status === "processing")
    return <Badge className="bg-primary/15 text-primary hover:bg-primary/15">Processing</Badge>;
  return <Badge variant="destructive">{status.replace(/_/g, " ")}</Badge>;
}

async function fileToBase64(file: File) {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buffer.length; i += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function Documents() {
  const queryClient = useQueryClient();
  const docs = useQuery(documentsQuery);
  const ingest = useServerFn(ingestDocument);
  const remove = useServerFn(deleteDocument);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const lower = file.name.toLowerCase();
      if (!ALLOWED.some((ext) => lower.endsWith(ext))) {
        throw new Error(`${file.name}: unsupported file type. Use PDF, DOCX, or TXT.`);
      }
      if (file.size > MAX_BYTES) {
        throw new Error(`${file.name}: file is larger than the 50 MB limit.`);
      }
      if (file.size === 0) throw new Error(`${file.name}: the file is empty.`);
      setUploading(file.name);
      const contentBase64 = await fileToBase64(file);
      return (await ingest({
        data: {
          filename: file.name,
          fileType: file.type || lower.split(".").pop() || "unknown",
          fileSize: file.size,
          contentBase64,
        },
      })) as { chunks: number; pages: number };
    },
    onSuccess: (data) => toast.success(`Indexed ${data.chunks} chunks from ${data.pages} page(s).`),
    onError: (error: Error) => toast.error(error.message || "Indexing failed."),
    onSettled: () => {
      setUploading(null);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Document removed from the index.");
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      await upload.mutateAsync(file).catch(() => undefined);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Document Index</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Files are extracted, chunked (~650 tokens, 100-token overlap), embedded, and stored in the
          vector index.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`panel flex cursor-pointer flex-col items-center justify-center gap-2 border-dashed p-10 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "hover:border-primary/60"
        }`}
      >
        <UploadCloud className="size-8 text-primary" />
        <p className="text-sm font-medium">Drag & drop documents, or click to browse</p>
        <p className="text-xs text-muted-foreground">PDF, DOCX, TXT · up to 50 MB per file</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.docx,.md"
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {uploading ? (
        <div className="panel flex items-center gap-3 p-4 text-sm">
          <Loader2 className="size-4 animate-spin text-primary" />
          Extracting, chunking and embedding <span className="font-medium">{uploading}</span>...
        </div>
      ) : null}

      <div className="panel divide-y divide-border">
        {docs.isLoading ? (
          <p className="p-5 text-sm text-muted-foreground">Loading index...</p>
        ) : (docs.data ?? []).length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">No documents indexed yet.</p>
        ) : (
          (docs.data ?? []).map((doc) => (
            <div key={doc.id} className="flex flex-wrap items-center gap-3 p-4">
              <FileText className="size-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.filename}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {doc.file_type} · {formatSize(doc.file_size)} · {doc.page_count} page(s) ·{" "}
                  {doc.chunk_count} chunks
                </p>
                {doc.error ? <p className="mt-1 text-xs text-destructive">{doc.error}</p> : null}
              </div>
              {statusBadge(doc.status)}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => del.mutate(doc.id)}
                aria-label={`Delete ${doc.filename}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
