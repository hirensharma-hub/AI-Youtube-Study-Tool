import { Flashcard } from "@/types";

import { generateChatCompletion, parseJsonArrayResponse } from "@/lib/ai";

function normalizeFlashcards(rawCards: unknown): Flashcard[] {
  const items = Array.isArray(rawCards)
    ? rawCards
    : rawCards && typeof rawCards === "object"
      ? Array.isArray((rawCards as Record<string, unknown>).flashcards)
        ? ((rawCards as Record<string, unknown>).flashcards as unknown[])
        : Array.isArray((rawCards as Record<string, unknown>).cards)
          ? ((rawCards as Record<string, unknown>).cards as unknown[])
          : [rawCards]
      : null;

  if (!items) {
    throw new Error("Flashcard payload is not an array.");
  }

  return items
    .map((item, index) => {
      const record = item as Record<string, unknown>;
      return {
        id:
          typeof record.id === "string" && record.id.trim()
            ? record.id.trim()
            : `flashcard-${index + 1}`,
        front: typeof record.front === "string" ? record.front.trim() : "",
        back: typeof record.back === "string" ? record.back.trim() : ""
      };
    })
    .filter((card) => card.front.length > 0 && card.back.length > 0);
}

export async function generateLessonFlashcards(input: {
  endpoint: string;
  model: string;
  accessToken?: string;
  flashcardSource: string;
}) {
  const rawResponse = await generateChatCompletion({
    endpoint: input.endpoint,
    model: input.model,
    accessToken: input.accessToken,
    temperature: 0.15,
    maxTokens: 1800,
    timeoutMs: 120000,
    responseFormat: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You create GCSE revision flashcards from a lesson transcript. Return JSON only."
      },
      {
        role: "user",
        content:
          `Create 10 concise GCSE flashcards from this lesson.\n\n` +
          `Requirements:\n` +
          `- Return JSON only.\n` +
          `- Use the shape {\"flashcards\":[{\"id\":\"flashcard-1\",\"front\":\"...\",\"back\":\"...\"}]}\n` +
          `- Make the front a short exam-relevant prompt.\n` +
          `- Make the back a clear answer based only on the lesson.\n` +
          `- Avoid filler or repeated cards.\n` +
          `- Keep the level strictly GCSE.\n\n` +
          `Lesson source:\n${input.flashcardSource}`
      }
    ]
  });

  const parsed = parseJsonArrayResponse(rawResponse);
  const flashcards = normalizeFlashcards(parsed);

  if (!flashcards.length) {
    throw new Error("Unable to generate flashcards right now.");
  }

  return flashcards;
}
