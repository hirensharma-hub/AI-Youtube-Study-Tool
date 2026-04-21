import { generateChatCompletion } from "@/lib/ai";

type ReferenceNote = {
  query: string;
  title: string;
  summary: string;
  url: string;
};

async function fetchJsonWithTimeout(url: string, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      return null;
    }

    return await response.json().catch(() => null);
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractVerificationQueries(input: {
  endpoint: string;
  model: string;
  accessToken?: string;
  cleanedTranscript: string;
}) {
  const raw = await generateChatCompletion({
    endpoint: input.endpoint,
    model: input.model,
    accessToken: input.accessToken,
    temperature: 0,
    maxTokens: 120,
    timeoutMs: 60000,
    messages: [
      {
        role: "system",
        content:
          "Extract concise GCSE topic queries from a lesson transcript. Return plain text only with one query per line and no numbering."
      },
      {
        role: "user",
        content:
          `From this GCSE lesson transcript, extract up to 3 short web-search queries for the main topic terms that should be fact-checked.\n\n` +
          `Rules:\n` +
          `- Keep them concise.\n` +
          `- Focus on the real subject terms, not generic words.\n` +
          `- Keep them suitable for Wikipedia lookups.\n` +
          `- Return one query per line.\n\n` +
          `Transcript:\n${input.cleanedTranscript.slice(0, 5000)}`
      }
    ]
  });

  return raw
    .split("\n")
    .map((line: string) => line.replace(/^[\-\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

async function fetchWikipediaSummary(query: string): Promise<ReferenceNote | null> {
  const searchUrl =
    `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}` +
    `&limit=1&namespace=0&format=json&origin=*`;
  const searchPayload = await fetchJsonWithTimeout(searchUrl);

  if (!Array.isArray(searchPayload) || !Array.isArray(searchPayload[1]) || !searchPayload[1][0]) {
    return null;
  }

  const title = String(searchPayload[1][0]);
  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const summaryPayload = await fetchJsonWithTimeout(summaryUrl);

  if (!summaryPayload || typeof summaryPayload !== "object") {
    return null;
  }

  const record = summaryPayload as Record<string, unknown>;
  const summary = typeof record.extract === "string" ? record.extract.trim() : "";
  const contentUrl =
    typeof record.content_urls === "object" && record.content_urls !== null
      ? ((record.content_urls as Record<string, unknown>).desktop as Record<string, unknown> | undefined)
      : undefined;
  const url = contentUrl && typeof contentUrl.page === "string" ? contentUrl.page : `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;

  if (!summary) {
    return null;
  }

  return {
    query,
    title,
    summary,
    url
  };
}

export async function collectVerificationReferences(queries: string[]) {
  const results = await Promise.all(queries.map((query) => fetchWikipediaSummary(query)));
  return results.filter((item): item is ReferenceNote => Boolean(item)).slice(0, 3);
}

export async function verifyAndRefineNotes(input: {
  endpoint: string;
  model: string;
  accessToken?: string;
  cleanedTranscript: string;
  draftNotes: string;
  references: ReferenceNote[];
}) {
  if (!input.references.length) {
    return input.draftNotes;
  }

  const referenceText = input.references
    .map((reference, index) => `Reference ${index + 1}: ${reference.title}\nSummary: ${reference.summary}\nURL: ${reference.url}`)
    .join("\n\n");

  return generateChatCompletion({
    endpoint: input.endpoint,
    model: input.model,
    accessToken: input.accessToken,
    temperature: 0,
    maxTokens: 2600,
    timeoutMs: 120000,
    messages: [
      {
        role: "system",
        content:
          "You are a careful GCSE notes verifier. Compare lesson notes against the transcript and a few web references. Correct only obvious transcription or terminology mistakes when the references strongly support the correction. Keep the notes grounded in the lesson and do not add unrelated material."
      },
      {
        role: "user",
        content:
          `Revise these GCSE notes so they make sense and fix obvious misheard terms.\n\n` +
          `Rules:\n` +
          `- Keep the notes grounded in the lesson transcript.\n` +
          `- Use the web references only to correct obvious misheard names, terms, or definitions.\n` +
          `- Do not add extra sections that were not in the lesson.\n` +
          `- Keep everything at GCSE level.\n` +
          `- Preserve the existing note structure where possible.\n\n` +
          `Lesson transcript:\n${input.cleanedTranscript.slice(0, 12000)}\n\n` +
          `Draft notes:\n${input.draftNotes}\n\n` +
          `Web references:\n${referenceText}`
      }
    ]
  });
}
