const GATEWAY = "https://ai.gateway.lovable.dev/v1";
export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export const CHAT_MODEL = "openai/gpt-6-astra";

export class AIError extends Error {}

function apiKey() {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new AIError("AI credentials are not configured for this project.");
  return key;
}

function friendly(status: number, body: string) {
  if (status === 429) return "AI rate limit reached. Please wait a moment and try again.";
  if (status === 402) return "AI credits are exhausted for this workspace. Add credits to continue.";
  return `AI request failed (${status}): ${body.slice(0, 300)}`;
}

/** Real embeddings via Lovable AI Gateway. */
export async function embedTexts(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const out: number[][] = [];
  const BATCH = 64;
  for (let i = 0; i < inputs.length; i += BATCH) {
    const batch = inputs.slice(i, i + BATCH);
    const res = await fetch(`${GATEWAY}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey(),
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
    });
    if (!res.ok) throw new AIError(friendly(res.status, await res.text()));
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    for (const item of sorted) out.push(item.embedding);
  }
  return out;
}

type JsonSchema = Record<string, unknown>;

/** Streaming call to the gateway Responses API; returns the accumulated text. */
async function responsesText(
  input: string,
  options: { schemaName?: string; schema?: JsonSchema; instructions?: string } = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    model: CHAT_MODEL,
    input,
    stream: true,
    store: false,
    reasoning: { effort: "low" },
  };
  if (options.instructions) body["instructions"] = options.instructions;
  if (options.schema && options.schemaName) {
    body["text"] = {
      format: {
        type: "json_schema",
        name: options.schemaName,
        strict: true,
        schema: options.schema,
      },
    };
  }

  const res = await fetch(`${GATEWAY}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey(),
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new AIError(friendly(res.status, await res.text()));
  if (!res.body) throw new AIError("AI response stream was empty.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let event: { type?: string; delta?: string; response?: { output_text?: string } };
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        text += event.delta;
      } else if (event.type === "response.completed" && !text && event.response?.output_text) {
        text = event.response.output_text;
      }
    }
  }
  return text.trim();
}

export async function generateJson<T>(
  input: string,
  schemaName: string,
  schema: JsonSchema,
  instructions?: string,
): Promise<T> {
  const text = await responsesText(input, { schemaName, schema, instructions });
  if (!text) throw new AIError("The model returned an empty response.");
  try {
    return JSON.parse(text) as T;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new AIError("The model returned a malformed response.");
  }
}
