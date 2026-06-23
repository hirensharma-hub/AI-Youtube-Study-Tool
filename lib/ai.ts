import { QuizQuestion } from "@/types";

/**
 * Models
 */
const PRIMARY_OLLAMA_CLOUD_MODEL =
  process.env.OLLAMA_MODEL || "llama3:70b";

const FALLBACK_OLLAMA_CLOUD_MODEL =
  process.env.OLLAMA_FALLBACK_MODEL || "llama3:8b";

/**
 * Types
 */
export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionInput {
  endpoint: string;
  model: string;
  accessToken?: string;
  messages: ProviderMessage[];
  temperature: number;
  maxTokens: number;
  timeoutMs?: number;
  responseFormat?: { type: "json_object" };
}

/**
 * ----------------------------
 * TEXT UTILITIES
 * ----------------------------
 */

export function chunkTranscript(text: string, maxChars = 2800): string[] {
  if (!text) return [];

  const chunks: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    if ((current + "\n" + line).length > maxChars) {
      chunks.push(current.trim());
      current = line;
    } else {
      current += "\n" + line;
    }
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

export function prepareTranscriptForModel(
  text: string,
  maxChars = 5200
): string {
  if (!text) return "";
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/**
 * ----------------------------
 * JSON HELPERS
 * ----------------------------
 */

export function extractJsonBlock(value: string): string | null {
  if (!value) return null;

  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) return null;

  return value.slice(start, end + 1);
}

export function parseJsonObjectResponse<T = any>(
  value: string
): T | null {
  try {
    const json = extractJsonBlock(value);
    if (!json) return null;
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function parseJsonArrayResponse<T = any>(
  value: string
): T[] {
  try {
    const json = extractJsonBlock(value);
    if (!json) return [];
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * ----------------------------
 * AI CORE
 * ----------------------------
 */

function getModelAttemptOrder(endpoint: string, model: string) {
  return [
    model || PRIMARY_OLLAMA_CLOUD_MODEL,
    FALLBACK_OLLAMA_CLOUD_MODEL
  ];
}

function shouldTryFallback(message: string, status?: number) {
  const normalized = message.toLowerCase();

  if (status === 401 || status === 403) return false;

  const hardStopSignals = [
    "api key",
    "access token",
    "unauthorized",
    "forbidden",
    "credits",
    "billing",
    "payment",
    "quota",
    "rate limit",
    "sign in"
  ];

  if (hardStopSignals.some((s) => normalized.includes(s))) {
    return false;
  }

  return true;
}

function extractTextFromContentParts(content: unknown): string {
  if (typeof content === "string") return content.trim();

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const record = part as Record<string, unknown>;
          if (typeof record.text === "string") return record.text;
        }
        return "";
      })
      .join("")
      .trim();
  }

  return "";
}

function extractCompletionText(payload: any) {
  return (
    extractTextFromContentParts(payload?.message?.content) ||
    extractTextFromContentParts(payload?.choices?.[0]?.message?.content) ||
    (typeof payload?.choices?.[0]?.text === "string"
      ? payload.choices[0].text.trim()
      : "") ||
    (typeof payload?.generated_text === "string"
      ? payload.generated_text.trim()
      : "") ||
    (typeof payload?.response === "string"
      ? payload.response.trim()
      : "")
  );
}

function getErrorMessage(payload: any) {
  return (
    payload?.message ||
    payload?.error?.message ||
    payload?.error ||
    "The AI provider rejected the request."
  );
}

/**
 * ----------------------------
 * MAIN AI CALL
 * ----------------------------
 */

export async function generateChatCompletion(
  input: ChatCompletionInput
) {
  if (
    input.endpoint.includes("ollama.com") &&
    !input.accessToken
  ) {
    throw new Error(
      "Set OLLAMA_API_KEY in .env.local to use Ollama Cloud."
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (input.accessToken) {
    headers.Authorization = `Bearer ${input.accessToken}`;
  }

  const modelAttempts = getModelAttemptOrder(
    input.endpoint,
    input.model
  );

  let lastError: Error | null = null;

  for (const model of modelAttempts) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        input.timeoutMs ?? 600000
      );

      try {
        const response = await fetch(input.endpoint, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify(
            input.endpoint.includes("/v1/")
              ? {
                  model,
                  stream: false,
                  temperature:
                    attempt === 0
                      ? input.temperature
                      : Math.min(input.temperature, 0.1),
                  max_tokens: input.maxTokens,
                  messages: input.messages,
                  ...(input.responseFormat
                    ? {
                        response_format:
                          input.responseFormat
                      }
                    : {})
                }
              : {
                  model,
                  stream: false,
                  messages: input.messages,
                  options: {
                    temperature:
                      attempt === 0
                        ? input.temperature
                        : Math.min(input.temperature, 0.1),
                    num_predict: input.maxTokens
                  }
                }
          )
        });

        clearTimeout(timeout);

        const payload = await response
          .json()
          .catch(() => null);

        if (!response.ok) {
          const errMsg = getErrorMessage(payload);

          if (!shouldTryFallback(errMsg, response.status)) {
            throw new Error(errMsg);
          }

          lastError = new Error(errMsg);
          continue;
        }

        return extractCompletionText(payload);
      } catch (err) {
        lastError = err as Error;
      }
    }
  }

  throw lastError || new Error("AI request failed");
}

/**
 * ----------------------------
 * COMPATIBILITY LAYER
 * ----------------------------
 */

export const buildRelevantTranscriptContext =
  prepareTranscriptForModel;
