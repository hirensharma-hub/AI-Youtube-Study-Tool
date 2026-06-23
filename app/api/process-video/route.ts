import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  chunkTranscript,
  generateChatCompletion,
  prepareTranscriptForModel
} from "@/lib/ai";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { env } from "@/lib/env";
import { generateLessonQuiz } from "@/lib/quiz";

import {
  CURRENT_PROCESSING_VERSION,
  getUserSettings,
  saveProcessedVideo
} from "@/lib/server-data";

import {
  extractVerificationQueries,
  collectVerificationReferences,
  verifyAndRefineNotes
} from "@/lib/web-verify";

import { extractYouTubeVideoId } from "@/lib/youtube";

/* =========================
   TYPES
========================= */

const processSchema = z.object({
  videoUrl: z.string().trim().url(),
  manualTranscript: z.string().trim().min(1).optional(),
  transcript: z
    .object({
      videoId: z.string().trim().min(11),
      rawTranscript: z.string().trim().min(1),
      transcriptLanguage: z.string().trim().optional()
    })
    .optional()
});

export const maxDuration = 300;

type TranscriptData = {
  videoId: string;
  rawTranscript: string;
  transcriptLanguage?: string;
};

type ProcessTaskState = {
  status: "running" | "completed" | "failed";
  stage: string;
  detail: string;
  progress: number;
  video?: any;
  error?: string;
};

type ProcessingCacheMap = Map<string, Promise<any>>;
type ProcessTaskMap = Map<string, ProcessTaskState>;

/* =========================
   GLOBAL CACHE
========================= */

declare global {
  // eslint-disable-next-line no-var
  var __studyProcessingCache: ProcessingCacheMap | undefined;
  // eslint-disable-next-line no-var
  var __studyProcessTasks: ProcessTaskMap | undefined;
}

const processingCache: ProcessingCacheMap =
  globalThis.__studyProcessingCache ?? new Map();

const processTasks: ProcessTaskMap =
  globalThis.__studyProcessTasks ?? new Map();

globalThis.__studyProcessingCache = processingCache;
globalThis.__studyProcessTasks = processTasks;

/* =========================
   HELPERS
========================= */

function buildVideoTitle(videoId: string) {
  return `Study video ${videoId}`;
}

function lightweightCleanTranscript(raw: string) {
  const seen = new Set<string>();

  return raw
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => l.length > 8)
    .filter((line) => {
      const n = line.toLowerCase();

      if (
        n.includes("subscribe") ||
        n.includes("like and share") ||
        n.includes("thanks for watching")
      ) return false;

      if (seen.has(n)) return false;

      seen.add(n);
      return true;
    })
    .join("\n");
}

/* =========================
   TRANSCRIPT CLEANING
========================= */

async function refineTranscriptForStudy(input: {
  endpoint: string;
  model: string;
  accessToken?: string;
  rawTranscript: string;
  onProgress?: (detail: string, progress: number) => void;
}) {
  const base = lightweightCleanTranscript(input.rawTranscript);
  const chunks = chunkTranscript(base, 2800);
  const cleaned: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    input.onProgress?.(
      `Cleaning transcript (${i + 1}/${chunks.length})`,
      18 + Math.round((i / chunks.length) * 12)
    );

    try {
      const res = await generateChatCompletion({
        endpoint: input.endpoint,
        model: input.model,
        accessToken: input.accessToken,
        temperature: 0,
        maxTokens: 900,
        messages: [
          {
            role: "system",
            content:
              "Clean YouTube GCSE lesson transcript. Remove intro, ads, filler. Keep only teaching content."
          },
          {
            role: "user",
            content: chunks[i]
          }
        ]
      });

      cleaned.push(res.trim());
    } catch {
      cleaned.push(chunks[i]);
    }
  }

  return cleaned.join("\n").trim();
}

/* =========================
   NOTES GENERATION
========================= */

async function generateDetailedNotes(input: {
  endpoint: string;
  model: string;
  accessToken?: string;
  cleanedTranscript: string;
  onProgress?: (detail: string, progress: number) => void;
}) {
  const chunks = chunkTranscript(input.cleanedTranscript, 2600);
  const notes: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    input.onProgress?.(
      `Generating notes (${i + 1}/${chunks.length})`,
      38 + Math.round((i / chunks.length) * 18)
    );

    const res = await generateChatCompletion({
      endpoint: input.endpoint,
      model: input.model,
      accessToken: input.accessToken,
      temperature: 0.15,
      maxTokens: 1000,
      messages: [
        {
          role: "system",
          content:
            "Turn transcript into GCSE revision notes. Keep accurate, structured, and concise."
        },
        {
          role: "user",
          content: chunks[i]
        }
      ]
    });

    notes.push(res);
  }

  input.onProgress?.("Combining notes", 58);

  return generateChatCompletion({
    endpoint: input.endpoint,
    model: input.model,
    accessToken: input.accessToken,
    temperature: 0.1,
    maxTokens: 2400,
    messages: [
      {
        role: "system",
        content:
          "Merge notes into final GCSE revision sheet with headings and bullet points."
      },
      {
        role: "user",
        content: notes.join("\n\n---\n\n")
      }
    ]
  });
}

/* =========================
   MAIN PROCESS PIPELINE
========================= */

async function runProcessing(
  videoUrl: string,
  userId: string,
  transcriptOverride?: TranscriptData,
  onProgress?: (state: any) => void
) {
  const settings = await getUserSettings(userId);

  if (!transcriptOverride) {
    throw new Error("No transcript provided.");
  }

  const cleanedTranscript = await refineTranscriptForStudy({
    endpoint: env.aiApiUrl,
    model: settings.model,
    accessToken: env.aiToken,
    rawTranscript: transcriptOverride.rawTranscript,
    onProgress
  });

  const notes = await generateDetailedNotes({
    endpoint: env.aiApiUrl,
    model: settings.model,
    accessToken: env.aiToken,
    cleanedTranscript,
    onProgress
  });

  const quizSource = prepareTranscriptForModel(cleanedTranscript, 5200);

  const quiz = await generateLessonQuiz({
    endpoint: env.aiApiUrl,
    model: settings.model,
    accessToken: env.aiToken,
    quizSource
  });

  return saveProcessedVideo({
    videoId: transcriptOverride.videoId,
    videoUrl,
    title: buildVideoTitle(transcriptOverride.videoId),
    rawTranscript: transcriptOverride.rawTranscript,
    cleanedTranscript,
    notes,
    quiz,
    flashcards: [],
    processingVersion: CURRENT_PROCESSING_VERSION,
    transcriptLanguage: transcriptOverride.transcriptLanguage
  });
}

/* =========================
   TASK HELPERS
========================= */

function createTaskId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function setTaskState(taskId: string, state: ProcessTaskState) {
  processTasks.set(taskId, state);
}

/* =========================
   API ROUTES
========================= */

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const taskId = request.nextUrl.searchParams.get("taskId");
  if (!taskId) return apiError("Missing taskId", 400);

  const task = processTasks.get(taskId);
  if (!task) return apiError("Task not found", 404);

  return NextResponse.json(task);
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  let body: any;

  try {
    body = await parseJsonBody(request);
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = processSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Invalid YouTube URL", 400);
  }

  try {
    const videoId = extractYouTubeVideoId(parsed.data.videoUrl);

    let transcriptOverride: TranscriptData | undefined;

    if (parsed.data.transcript?.rawTranscript) {
      transcriptOverride = {
        videoId,
        rawTranscript: parsed.data.transcript.rawTranscript,
        transcriptLanguage: parsed.data.transcript.transcriptLanguage
      };
    } else if (parsed.data.manualTranscript) {
      transcriptOverride = {
        videoId,
        rawTranscript: parsed.data.manualTranscript,
        transcriptLanguage: "manual"
      };
    }

    const taskId = createTaskId();

    setTaskState(taskId, {
      status: "running",
      stage: "queued",
      detail: "Starting",
      progress: 5
    });

    const promise = runProcessing(
      parsed.data.videoUrl,
      user.id,
      transcriptOverride,
      (state) => {
        const prev = processTasks.get(taskId);
        setTaskState(taskId, {
          ...prev,
          ...state,
          status: "running"
        });
      }
    );

    promise.then((video) => {
      setTaskState(taskId, {
        status: "completed",
        stage: "done",
        detail: "Complete",
        progress: 100,
        video
      });
    });

    promise.catch((error) => {
      setTaskState(taskId, {
        status: "failed",
        stage: "failed",
        detail: "Failed",
        progress: 100,
        error: error instanceof Error ? error.message : "Processing failed"
      });
    });

    return NextResponse.json({ taskId, done: false });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Processing failed";

    return apiError(message, 500);
  }
}
