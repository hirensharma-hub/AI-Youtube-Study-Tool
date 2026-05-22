import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { env } from "@/lib/env";
import { generateLessonFlashcards } from "@/lib/flashcards";
import { prepareTranscriptForModel } from "@/lib/ai";
import { getProcessedVideoByVideoId, getUserSettings, updateProcessedVideoFlashcards } from "@/lib/server-data";

const generateFlashcardsSchema = z.object({
  videoId: z.string().trim().min(6).max(32)
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

  const parsed = generateFlashcardsSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("A valid processed video is required.");
  }

  const processedVideo = await getProcessedVideoByVideoId(parsed.data.videoId);
  if (!processedVideo) {
    return apiError("Process the video first before generating flashcards.", 404);
  }

  if (processedVideo.flashcards.length) {
    return NextResponse.json({ video: processedVideo, cached: true });
  }

  try {
    const settings = await getUserSettings(user.id);
    const flashcardSource = prepareTranscriptForModel(
      `${processedVideo.notes}\n\n${processedVideo.cleanedTranscript}`,
      2600
    );
    const flashcards = await generateLessonFlashcards({
      endpoint: env.aiApiUrl,
      model: settings.model,
      accessToken: env.aiToken,
      flashcardSource
    });

    const updatedVideo = await updateProcessedVideoFlashcards(processedVideo.videoId, flashcards);
    if (!updatedVideo) {
      throw new Error("The flashcards were generated but the lesson could not be updated.");
    }

    return NextResponse.json({ video: updatedVideo, cached: false });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Unable to generate flashcards right now.", 500);
  }
}
