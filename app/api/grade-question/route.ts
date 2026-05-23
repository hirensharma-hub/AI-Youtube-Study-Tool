import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { generateChatCompletion, parseJsonObjectResponse } from "@/lib/ai";
import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { env } from "@/lib/env";
import { getProcessedVideoByVideoId, getUserSettings } from "@/lib/server-data";
import { ShortAnswerGrade } from "@/types";

const gradeSchema = z.object({
  videoId: z.string().trim().min(6).max(32),
  questionId: z.string().trim().min(1).max(120),
  studentAnswer: z.string().trim().min(1).max(6000)
});

function normalizeGrade(payload: unknown, totalMarks: number, fallbackPoints: Array<{ id: string; label: string; marks: number }>): ShortAnswerGrade {
  const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const awardedMarks =
    typeof record.awardedMarks === "number" && Number.isFinite(record.awardedMarks)
      ? Math.max(0, Math.min(totalMarks, Math.round(record.awardedMarks)))
      : 0;
  const feedback = typeof record.feedback === "string" && record.feedback.trim() ? record.feedback : "No detailed feedback returned.";
  const matchedPoints = Array.isArray(record.matchedPoints)
    ? record.matchedPoints.map((point, index) => {
        const pointRecord = point as Record<string, unknown>;
        const fallback = fallbackPoints[index];
        return {
          pointId:
            typeof pointRecord.pointId === "string" && pointRecord.pointId
              ? pointRecord.pointId
              : fallback?.id ?? `point-${index + 1}`,
          label:
            typeof pointRecord.label === "string" && pointRecord.label
              ? pointRecord.label
              : fallback?.label ?? `Point ${index + 1}`,
          awarded: Boolean(pointRecord.awarded),
          reason:
            typeof pointRecord.reason === "string" && pointRecord.reason
              ? pointRecord.reason
              : "No reason provided.",
          marks:
            typeof pointRecord.marks === "number" && Number.isFinite(pointRecord.marks)
              ? Math.max(0, Math.round(pointRecord.marks))
              : fallback?.marks ?? 1
        };
      })
    : fallbackPoints.map((point) => ({
        pointId: point.id,
        label: point.label,
        awarded: false,
        reason: "No grading detail returned.",
        marks: point.marks
      }));

  return {
    awardedMarks,
    totalMarks,
    feedback,
    matchedPoints
  };
}

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

  const parsed = gradeSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("A valid video, question, and written answer are required.");
  }

  const processedVideo = await getProcessedVideoByVideoId(parsed.data.videoId);
  if (!processedVideo) {
    return apiError("Process the video first before grading questions.", 404);
  }

  const question = processedVideo.quiz.find((item) => item.id === parsed.data.questionId && item.type === "short-answer");
  if (!question) {
    return apiError("That written question could not be found.", 404);
  }

  const fallbackPoints = (question.markScheme ?? []).map((point) => ({
    id: point.id,
    label: point.label,
    marks: point.marks
  }));

  try {
    const settings = await getUserSettings(user.id);
    const rawGrade = await generateChatCompletion({
      endpoint: env.aiApiUrl,
      model: settings.model,
      accessToken: env.aiToken,
      temperature: 0,
      maxTokens: Math.min(Math.max(settings.maxTokens, 700), 1000),
      timeoutMs: 180000,
      messages: [
        {
          role: "system",
          content:
            "You are a strict GCSE examiner. Mark only against the provided mark scheme and transcript context. Do not invent extra marking points. Use the mark scheme exactly as written. Return valid JSON only as an object with awardedMarks, feedback, and matchedPoints. matchedPoints must be an array of { pointId, label, awarded, reason, marks }."
        },
        {
          role: "user",
          content:
            `Question:\n${question.question}\n\n` +
            `Total marks:\n${question.markCount}\n\n` +
            `Model answer:\n${question.answer}\n\n` +
            `Mark scheme:\n${JSON.stringify(question.markScheme ?? [])}\n\n` +
            `Transcript context:\n${processedVideo.cleanedTranscript}\n\n` +
            `Student answer:\n${parsed.data.studentAnswer}\n\n` +
            `Rules:\n` +
            `- Award marks point by point using the supplied mark scheme only.\n` +
            `- If a point is repeated, do not award it twice.\n` +
            `- Be realistic for GCSE marking.\n` +
            `- Feedback should briefly explain what was credited and what was missing.\n`
        }
      ]
    });

    const parsedGrade = parseJsonObjectResponse(rawGrade);
    const grade = normalizeGrade(parsedGrade, question.markCount, fallbackPoints);

    return NextResponse.json({ grade });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Unable to grade this answer right now.", 500);
  }
}
