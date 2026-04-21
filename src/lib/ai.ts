import { QuizQuestion } from "@/types";

const PRIMARY_OLLAMA_CLOUD_MODEL = "deepseek-v3.1:671b-cloud";
const FALLBACK_OLLAMA_CLOUD_MODEL = "gpt-oss:120b-cloud";

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

function getModelAttemptOrder(endpoint: string, model: string) {
  if (!endpoint.includes("ollama.com")) {
    return [model];
  }

  const normalizedModel = model.trim();
  const preferredOrder = [
    PRIMARY_OLLAMA_CLOUD_MODEL,
    FALLBACK_OLLAMA_CLOUD_MODEL,
    normalizedModel
  ].filter(Boolean);

  return Array.from(new Set(preferredOrder));
}

function shouldTryFallback(message: string, status?: number) {
  const normalized = message.toLowerCase();

  if (status === 401 || status === 403) {
    return false;
  }

  if (
    normalized.includes("api key") ||
    normalized.includes("access token") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("credits") ||
    normalized.includes("billing") ||
    normalized.includes("payment") ||
    normalized.includes("quota") ||
    normalized.includes("rate limit") ||
    normalized.includes("sign in")
  ) {
    return false;
  }

  return true;
}

function extractTextFromContentParts(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (typeof part === "object" && part !== null) {
          const record = part as Record<string, unknown>;
          if (typeof record.text === "string") {
            return record.text;
          }
        }

        return "";
      })
      .join("")
      .trim();
  }

  return "";
}

function extractCompletionText(payload: any) {
  const ollamaMessage = extractTextFromContentParts(payload?.message?.content);
  if (ollamaMessage) {
    return ollamaMessage;
  }

  const choice = payload?.choices?.[0];
  const messageContent = extractTextFromContentParts(choice?.message?.content);
  if (messageContent) {
    return messageContent;
  }

  const directText = typeof choice?.text === "string" ? choice.text.trim() : "";
  if (directText) {
    return directText;
  }

  const generatedText = typeof payload?.generated_text === "string" ? payload.generated_text.trim() : "";
  if (generatedText) {
    return generatedText;
  }

  const directResponse = typeof payload?.response === "string" ? payload.response.trim() : "";
  if (directResponse) {
    return directResponse;
  }

  return "";
}

function getErrorMessage(payload: unknown) {
  if (typeof payload !== "object" || payload === null) {
    return "The AI provider rejected the request. Check the hosted token, model, or usage limits.";
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.message === "string") {
    return record.message;
  }

  if (typeof record.error === "string") {
    return record.error;
  }

  if (typeof record.error === "object" && record.error !== null) {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.message === "string") {
      return nested.message;
    }
  }

  return "The AI provider rejected the request. Check the hosted token, model, or usage limits.";
}

export async function generateChatCompletion(input: ChatCompletionInput) {
  if (input.endpoint.includes("ollama.com") && !input.accessToken) {
    throw new Error("Set OLLAMA_API_KEY in .env.local to use Ollama Cloud.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (input.accessToken) {
    headers.Authorization = `Bearer ${input.accessToken}`;
  }

  let lastPayload: unknown = null;
  let lastError: Error | null = null;
  const modelAttempts = getModelAttemptOrder(input.endpoint, input.model);

  for (const model of modelAttempts) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 600000);

      let response: Response;

      try {
        response = await fetch(input.endpoint, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify(
            input.endpoint.includes("/v1/")
              ? {
                  model,
                  stream: false,
                  temperature: attempt === 0 ? input.temperature : Math.min(input.temperature, 0.1),
                  max_tokens: input.maxTokens,
                  messages: input.messages,
                  ...(input.responseFormat ? { response_format: input.responseFormat } : {})
                }
              : {
                  model,
                  stream: false,
                  messages: input.messages,
                  options: {
                    temperature: attempt === 0 ? input.temperature : Math.min(input.temperature, 0.1),
                    num_predict: input.maxTokens
                  }
                }
          )
        });
      } catch (error) {
        clearTimeout(timeout);

        if (error instanceof Error && error.name === "AbortError") {
          lastError = new Error("The AI request timed out while processing the video.");
          break;
        }

        throw error;
      }

      clearTimeout(timeout);

      const payload = await response.json().catch(() => null);
      lastPayload = payload;

      if (!response.ok) {
        const nextError = new Error(getErrorMessage(payload));
        if (shouldTryFallback(nextError.message, response.status) && model !== modelAttempts.at(-1)) {
          lastError = nextError;
          break;
        }

        throw nextError;
      }

      const text = extractCompletionText(payload);
      if (text) {
        return text;
      }

      lastError = new Error("The AI provider returned an empty response.");
    }
  }

  if (lastError) {
    if (lastError.message === "The AI provider returned an empty response." && modelAttempts.length > 1) {
      throw new Error("The AI provider returned an empty response even after switching to the fallback model.");
    }

    throw lastError;
  }

  if (typeof lastPayload === "object" && lastPayload !== null) {
    throw new Error("The AI provider returned an empty response even after switching to the fallback model.");
  }

  throw new Error("The AI provider returned an empty response.");
}

function findBalancedJsonSlice(value: string, openChar: "[" | "{", closeChar: "]" | "}") {
  const start = value.indexOf(openChar);
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === openChar) {
      depth += 1;
      continue;
    }

    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1).trim();
      }
    }
  }

  return null;
}

export function extractJsonBlock(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? value.trim();
  const arraySlice = findBalancedJsonSlice(candidate, "[", "]");
  if (arraySlice) {
    return arraySlice;
  }

  const objectSlice = findBalancedJsonSlice(candidate, "{", "}");
  if (objectSlice) {
    return objectSlice;
  }

  throw new Error("The AI provider returned quiz content in an unexpected format.");
}

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
          "Repair malformed JSON. Return only valid JSON as an array. Do not add commentary, markdown, or explanation."
      },
      {
        role: "user",
        content: input.brokenJson
      }
    ],
    timeoutMs: 30000
  });
}

export function parseJsonArrayResponse(value: string) {
  try {
    const parsed = JSON.parse(extractJsonBlock(value));

    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.questions)) {
        return record.questions;
      }

      if (Array.isArray(record.quiz)) {
        return record.quiz;
      }

      if (
        typeof record.question === "string" ||
        Array.isArray(record.options) ||
        record.type === "mcq" ||
        record.type === "short-answer"
      ) {
        return [record];
      }
    }

    throw new Error("Quiz payload is not an array.");
  } catch {
    throw new Error("The AI provider returned quiz content in an invalid format. Please try again.");
  }
}

export function parseJsonObjectResponse(value: string) {
  const fenced = value.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? value.trim();
  const firstBrace = candidate.indexOf("{");

  if (firstBrace < 0) {
    throw new Error("The AI provider returned grading content in an invalid format. Please try again.");
  }

  try {
    return JSON.parse(candidate.slice(firstBrace));
  } catch {
    throw new Error("The AI provider returned grading content in an invalid format. Please try again.");
  }
}

export function prepareTranscriptForModel(transcript: string, maxChars: number) {
  const normalized = transcript.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = Math.floor(maxChars * 0.22);
  const head = normalized.slice(0, headChars).trim();
  const tail = normalized.slice(-tailChars).trim();

  return `${head}\n\n[Transcript shortened for processing]\n\n${tail}`;
}

export function chunkTranscript(transcript: string, maxChars: number) {
  const normalized = transcript.trim();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
    }

    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }

    for (let index = 0; index < paragraph.length; index += maxChars) {
      chunks.push(paragraph.slice(index, index + maxChars).trim());
    }

    current = "";
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

export function buildRelevantTranscriptContext(input: {
  question: string;
  cleanedTranscript: string;
  rawTranscript: string;
  maxChars: number;
}) {
  const searchSpace = `${input.cleanedTranscript}\n${input.rawTranscript}`.replace(/\r/g, "");
  const segments = searchSpace
    .split(/\n+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 20);

  const keywords = Array.from(
    new Set(
      input.question
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((word) => word.trim())
        .filter((word) => word.length > 2)
    )
  );

  const scoredSegments = segments
    .map((segment) => {
      const normalized = segment.toLowerCase();
      const score = keywords.reduce((total, keyword) => total + (normalized.includes(keyword) ? 1 : 0), 0);
      return { segment, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.segment.length - left.segment.length);

  const selected: string[] = [];
  let totalChars = 0;

  for (const item of scoredSegments) {
    if (totalChars + item.segment.length > input.maxChars) {
      continue;
    }

    selected.push(item.segment);
    totalChars += item.segment.length + 2;

    if (totalChars >= input.maxChars * 0.85) {
      break;
    }
  }

  if (!selected.length) {
    return prepareTranscriptForModel(searchSpace, input.maxChars);
  }

  return selected.join("\n");
}

function normalizeAnswerText(value: string) {
  return value
    .toLowerCase()
    .replace(/^[a-d][\).:-]?\s*/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function deriveCorrectOptionId(
  answer: string,
  options: Array<{ id: string; text: string }>,
  explicitCorrectOptionId?: string
) {
  if (explicitCorrectOptionId && options.some((option) => option.id === explicitCorrectOptionId)) {
    return explicitCorrectOptionId;
  }

  const normalizedAnswer = normalizeAnswerText(answer);

  const exactMatch = options.find((option) => normalizeAnswerText(option.text) === normalizedAnswer);
  if (exactMatch) {
    return exactMatch.id;
  }

  const containsMatch = options.find((option) => {
    const normalizedOption = normalizeAnswerText(option.text);
    return normalizedOption.includes(normalizedAnswer) || normalizedAnswer.includes(normalizedOption);
  });

  return containsMatch?.id ?? options[0]?.id ?? "option-1";
}

export function normalizeQuizQuestions(rawQuiz: unknown): QuizQuestion[] {
  const quizItems = Array.isArray(rawQuiz)
    ? rawQuiz
    : rawQuiz && typeof rawQuiz === "object"
      ? Array.isArray((rawQuiz as Record<string, unknown>).questions)
        ? ((rawQuiz as Record<string, unknown>).questions as unknown[])
        : Array.isArray((rawQuiz as Record<string, unknown>).quiz)
          ? ((rawQuiz as Record<string, unknown>).quiz as unknown[])
          : [rawQuiz]
      : null;

  if (!quizItems) {
    throw new Error("Quiz payload is not an array.");
  }

  return quizItems.map((question, index) => {
    const record = question as Record<string, unknown>;
    const type: QuizQuestion["type"] = record.type === "short-answer" ? "short-answer" : "mcq";
    const options = Array.isArray(record.options)
      ? record.options.map((option, optionIndex) => {
          const optionRecord = option as Record<string, unknown>;
          return {
            id:
              typeof optionRecord.id === "string" && optionRecord.id
                ? optionRecord.id
                : `option-${optionIndex + 1}`,
            text: typeof optionRecord.text === "string" ? optionRecord.text : ""
          };
        })
      : [];
    const answer = typeof record.answer === "string" ? record.answer : "";
    const markScheme = Array.isArray(record.markScheme)
      ? record.markScheme.map((point, pointIndex) => {
          const pointRecord = point as Record<string, unknown>;
          const acceptedAnswers = Array.isArray(pointRecord.acceptedAnswers)
            ? pointRecord.acceptedAnswers.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            : [];

          return {
            id:
              typeof pointRecord.id === "string" && pointRecord.id
                ? pointRecord.id
                : `point-${index + 1}-${pointIndex + 1}`,
            label:
              typeof pointRecord.label === "string" && pointRecord.label.trim()
                ? pointRecord.label
                : `Point ${pointIndex + 1}`,
            marks:
              typeof pointRecord.marks === "number" && Number.isFinite(pointRecord.marks)
                ? Math.max(1, Math.min(6, Math.round(pointRecord.marks)))
                : 1,
            acceptedAnswers
          };
        })
      : undefined;
    const correctOptionId =
      type === "mcq"
        ? deriveCorrectOptionId(
            answer,
            options,
            typeof record.correctOptionId === "string" ? record.correctOptionId : undefined
          )
        : undefined;
    const markCount =
      typeof record.markCount === "number" && Number.isFinite(record.markCount)
        ? Math.max(1, Math.min(12, Math.round(record.markCount)))
        : type === "short-answer"
          ? 3
          : 1;

    return {
      id: typeof record.id === "string" && record.id ? record.id : `question-${index + 1}`,
      type,
      question: typeof record.question === "string" ? record.question : `Question ${index + 1}`,
      answer,
      explanation: typeof record.explanation === "string" ? record.explanation : "",
      options: type === "mcq" ? options : undefined,
      correctOptionId,
      markCount,
      markScheme: type === "short-answer" ? markScheme : undefined
    };
  }).filter((question) => (question.type === "mcq" ? (question.options?.length ?? 0) >= 2 : true));
}
