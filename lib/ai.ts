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
 * Model fallback order (FIXED)
 */
function getModelAttemptOrder(endpoint: string, model: string) {
  return [
    model || PRIMARY_OLLAMA_CLOUD_MODEL,
    FALLBACK_OLLAMA_CLOUD_MODEL
  ];
}

/**
 * Decide whether fallback is allowed
 */
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

/**
 * Extract text safely from different provider formats
 */
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

/**
 * Normalize completion response across providers
 */
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

/**
 * Error parsing helper
 */
function getErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "The AI provider rejected the request.";
  }

  const record = payload as Record<string, any>;

  return (
    record.message ||
    record.error?.message ||
    record.error ||
    "The AI provider rejected the request."
  );
}

/**
 * MAIN AI CALL FUNCTION (FIXED fallback behaviour)
 */
export async function generateChatCompletion(
  input: ChatCompletionInput
) {
  if (input.endpoint.includes("ollama.com") && !input.accessToken) {
    throw new Error("Set OLLAMA_API_KEY in .env.local to use Ollama Cloud.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (input.accessToken) {
    headers.Authorization = `Bearer ${input.accessToken}`;
  }

  const modelAttempts = getModelAttemptOrder(input.endpoint, input.model);

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
                    ? { response_format: input.responseFormat }
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

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          const err = new Error(getErrorMessage(payload));

          if (
            shouldTryFallback(err.message, response.status) &&
            model !== modelAttempts.at(-1)
          ) {
            lastError = err;
            break; // go to next model
          }

          throw err;
        }

        const text = extractCompletionText(payload);

        if (text) return text;

        lastError = new Error("The AI provider returned an empty response.");
      } catch (error: any) {
        clearTimeout(timeout);

        if (error?.name === "AbortError") {
          lastError = new Error("The AI request timed out.");
          break;
        }

        lastError = error;
      }
    }
  }

  throw (
    lastError ||
    new Error("The AI provider returned an empty response.")
  );
}

/**
 * JSON extraction helpers (UNCHANGED but kept clean)
 */
function findBalancedJsonSlice(
  value: string,
  openChar: "[" | "{",
  closeChar: "]" | "}"
) {
  const start = value.indexOf(openChar);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = start; i < value.length; i++) {
    const char = value[i];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === openChar) depth++;
    if (char === closeChar) {
      depth--;
      if (depth === 0) return value.slice(start, i + 1).trim();
    }
  }

  return null;
}

export function extractJsonBlock(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? value.trim();

  return (
    findBalancedJsonSlice(candidate, "[", "]") ||
    findBalancedJsonSlice(candidate, "{", "}") ||
    (() => {
      throw new Error("Invalid JSON format");
    })()
  );
}

/**
 * Quiz JSON repair
 */
export async function repairQuizJson(input: {
  endpoint: string;
  model: string;
  accessToken?: string;
  brokenJson: string;
}) {
  return generateChatCompletion({
    endpoint: input.endpoint,
    model: input.model,
    accessToken: input.accessToken,
    temperature: 0,
    maxTokens: 1800,
    messages: [
      {
        role: "system",
        content:
          "Repair malformed JSON. Return only valid JSON array."
      },
      {
        role: "user",
        content: input.brokenJson
      }
    ],
    timeoutMs: 30000
  });
}
