import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prepareTranscriptForModel } from "@/lib/ai";
import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { env } from "@/lib/env";
import { generateLessonQuiz } from "@/lib/quiz";
import { getProcessedVideoByVideoId, getUserSettings, updateProcessedVideoQuiz } from "@/lib/server-data";

const generateQuizSchema = z.object({
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

  const parsed = generateQuizSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("A valid processed video is required.");
  }

  const processedVideo = await getProcessedVideoByVideoId(parsed.data.videoId);
  if (!processedVideo) {
    return apiError("Process the video first before generating a quiz.", 404);
  }

  // ⭐ FIXED: If quiz already exists, match the frontend's expectation by passing the quiz array
  if (processedVideo.quiz && processedVideo.quiz.length > 0) {
    return NextResponse.json({ quiz: processedVideo.quiz, cached: true });
  }

  try {
    const settings = await getUserSettings(user.id);
    const quizSource = prepareTranscriptForModel(`${processedVideo.notes}\n\n${processedVideo.cleanedTranscript}`, 2600);
    
    const quiz = await generateLessonQuiz({
      endpoint: env.aiApiUrl,
      model: settings.model,
      accessToken: env.aiToken,
      quizSource
    });

    const updatedVideo = await updateProcessedVideoQuiz(processedVideo.videoId, quiz);
    if (!updatedVideo) {
      throw new Error("The quiz was generated but the lesson could not be updated.");
    }

    // ⭐ FIXED: Return the quiz property directly so data.quiz maps seamlessly in the workspace view
    return NextResponse.json({ quiz: updatedVideo.quiz, cached: false });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Unable to generate this quiz right now.", 500);
  }
}
