import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { buildRelevantTranscriptContext, generateChatCompletion, prepareTranscriptForModel } from "@/lib/ai";
import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { env } from "@/lib/env";
import { getProcessedVideoByVideoId, getUserSettings } from "@/lib/server-data";

const askSchema = z.object({
  videoId: z.string().trim().min(6).max(32),
  question: z.string().trim().min(1).max(4000)
});

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser();
  if (!user) {
    return response;
  }

  let body: unknown;

  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "The request payload was invalid.", 400);
  }

  const parsed = askSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("A valid video and question are required.");
  }

  const processedVideo = await getProcessedVideoByVideoId(parsed.data.videoId);
  if (!processedVideo) {
    return apiError("Process the video first before asking questions.", 404);
  }

  try {
    const settings = await getUserSettings(user.id);
    const transcriptContext = buildRelevantTranscriptContext({
      question: parsed.data.question,
      cleanedTranscript: processedVideo.cleanedTranscript,
      rawTranscript: processedVideo.rawTranscript,
      maxChars: 12000
    });
    const noteContext = prepareTranscriptForModel(processedVideo.notes, 5000);

    const answer = await generateChatCompletion({
      endpoint: env.aiApiUrl,
      model: settings.model,
      accessToken: env.aiToken,
      temperature: 0.1,
      maxTokens: Math.min(Math.max(settings.maxTokens, 500), 700),
      timeoutMs: 180000,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful GCSE study assistant for the topic of the lesson. Use the transcript excerpts first, but you may also answer using closely related topic knowledge if the question is clearly about the same GCSE subject and level as the lesson. Keep answers strictly at GCSE level. If the question is unrelated to the lesson topic or goes beyond GCSE scope, refuse briefly and say it is outside the scope of this video. When you go beyond the transcript, keep it minimal and clearly frame it as GCSE topic guidance rather than quoting the video."
        },
        {
          role: "user",
          content:
            `Lesson title:\n${processedVideo.title}\n\n` +
            `Lesson notes:\n${noteContext}\n\n` +
            `Transcript excerpts:\n${transcriptContext}\n\n` +
            `Question:\n${parsed.data.question}\n\n` +
            `Answer if it relates to the same topic as the lesson. Keep the response useful, accurate, and at the same study level as the lesson.`
        }
      ]
    });

    return NextResponse.json({ answer });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Unable to answer this question.", 500);
  }
}
