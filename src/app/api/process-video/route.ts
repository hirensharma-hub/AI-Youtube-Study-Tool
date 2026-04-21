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
import { CURRENT_PROCESSING_VERSION, getProcessedVideoByVideoId, getUserSettings, saveProcessedVideo } from "@/lib/server-data";
import { collectVerificationReferences, extractVerificationQueries, verifyAndRefineNotes } from "@/lib/web-verify";
import { fetchVideoTranscript } from "@/lib/youtube";

const processSchema = z.object({
  videoUrl: z.string().trim().url()
});

type ProcessTaskState = {
  status: "running" | "completed" | "failed";
  stage: string;
  detail: string;
  progress: number;
  video?: Awaited<ReturnType<typeof runProcessing>>;
  error?: string;
};

type ProcessingCacheMap = Map<string, Promise<Awaited<ReturnType<typeof runProcessing>>>>;
type ProcessTaskMap = Map<string, ProcessTaskState>;

declare global {
  // eslint-disable-next-line no-var
  var __studyProcessingCache: ProcessingCacheMap | undefined;
  // eslint-disable-next-line no-var
  var __studyProcessTasks: ProcessTaskMap | undefined;
}

const processingCache: ProcessingCacheMap = globalThis.__studyProcessingCache ?? new Map();
const processTasks: ProcessTaskMap = globalThis.__studyProcessTasks ?? new Map();

if (!globalThis.__studyProcessingCache) {
  globalThis.__studyProcessingCache = processingCache;
}

if (!globalThis.__studyProcessTasks) {
  globalThis.__studyProcessTasks = processTasks;
}

function buildVideoTitle(videoId: string) {
  return `Study video ${videoId}`;
}

function lightweightCleanTranscript(rawTranscript: string) {
  const seen = new Set<string>();
  const lines = rawTranscript
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.length > 8);

  const cleaned = lines.filter((line) => {
    const normalized = line.toLowerCase();
    if (
      normalized.includes("subscribe") ||
      normalized.includes("like and share") ||
      normalized.includes("thanks for watching")
    ) {
      return false;
    }

    if (seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });

  return cleaned.join("\n");
}

async function refineTranscriptForStudy(input: {
  endpoint: string;
  model: string;
  accessToken?: string;
  rawTranscript: string;
  onProgress?: (detail: string, progress: number) => void;
}) {
  const baseTranscript = lightweightCleanTranscript(input.rawTranscript);
  const chunks = chunkTranscript(baseTranscript, 2800);
  const cleanedChunks: string[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    input.onProgress?.(`Cleaning the lesson transcript (${index + 1}/${chunks.length})`, 18 + Math.round((index / Math.max(chunks.length, 1)) * 12));

    try {
      const cleanedChunk = await generateChatCompletion({
        endpoint: input.endpoint,
        model: input.model,
        accessToken: input.accessToken,
        temperature: 0,
        maxTokens: 900,
        timeoutMs: 120000,
        messages: [
          {
            role: "system",
            content:
              "You are cleaning a YouTube lesson transcript for GCSE study use. Keep only the educational teaching content. Remove greetings, channel intros, sponsor mentions, calls to like/subscribe, repeated recaps, off-topic chat, and outros. Do not add any new information. Return plain cleaned lesson text only."
          },
          {
            role: "user",
            content:
              `Clean this transcript chunk for GCSE study use.\n\n` +
              `Rules:\n` +
              `- Keep only educational teaching content.\n` +
              `- Remove introductions like welcome to the channel.\n` +
              `- Remove calls to action, sponsor lines, and outro lines.\n` +
              `- Remove repeated filler and repeated recap wording.\n` +
              `- Keep the original meaning and order of the teaching points.\n` +
              `- Return plain cleaned transcript text only.\n\n` +
              `Transcript chunk:\n${chunks[index]}`
          }
        ]
      });

      cleanedChunks.push(cleanedChunk.trim());
    } catch {
      cleanedChunks.push(chunks[index]);
    }
  }

  return cleanedChunks.join("\n").trim();
}

async function generateDetailedNotes(input: {
  endpoint: string;
  model: string;
  accessToken?: string;
  cleanedTranscript: string;
  onProgress?: (detail: string, progress: number) => void;
}) {
  const chunks = chunkTranscript(input.cleanedTranscript, 2600);
  const chunkNotes: string[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    input.onProgress?.(`Generating detailed notes (${index + 1}/${chunks.length})`, 38 + Math.round((index / Math.max(chunks.length, 1)) * 18));

    const sectionNotes = await generateChatCompletion({
      endpoint: input.endpoint,
      model: input.model,
      accessToken: input.accessToken,
      temperature: 0.15,
      maxTokens: 1000,
      timeoutMs: 120000,
      messages: [
        {
          role: "system",
          content:
            "You are an expert GCSE study-note writer. Turn the supplied lesson transcript into rich, accurate GCSE revision notes. Stay grounded in the source, cover all meaningful teaching points, and do not drift into unrelated, advanced, or non-GCSE material."
        },
        {
          role: "user",
          content:
            `Create detailed revision notes from this lesson section.\n\n` +
            `Requirements:\n` +
            `- Keep the explanation level matched to GCSE.\n` +
            `- Cover all meaningful educational content from this section.\n` +
            `- Remove filler, intros, and repeated phrasing.\n` +
            `- Use headings and bullet points.\n` +
            `- Keep explanations clear for a student revising from the video.\n` +
            `- Do not add outside-topic material or anything beyond GCSE level.\n` +
            `- Do not use markdown tables.\n\n` +
            `Lesson section:\n${chunks[index]}`
        }
      ]
    });

    chunkNotes.push(sectionNotes);
  }

  input.onProgress?.("Combining the lesson notes", 58);

  return generateChatCompletion({
    endpoint: input.endpoint,
    model: input.model,
    accessToken: input.accessToken,
    temperature: 0.1,
    maxTokens: 2400,
    timeoutMs: 120000,
    messages: [
      {
        role: "system",
        content:
          "You are an expert GCSE study-note editor. Merge the supplied grounded section notes into one detailed revision sheet. Keep all important teaching points, avoid repetition, stay close to the source material, and keep the level strictly GCSE."
      },
      {
        role: "user",
        content:
          `Turn these section notes into one final detailed revision sheet.\n\n` +
          `Requirements:\n` +
          `- Begin with a concise title.\n` +
          `- Include a short "Brief Overview" section.\n` +
          `- Include a "Key Points" section.\n` +
          `- Use clear headings and bullet points.\n` +
          `- Keep as much meaningful detail as possible from the lesson.\n` +
          `- Do not add unrelated knowledge that was not taught in the video.\n` +
          `- Keep all explanations strictly at GCSE level.\n` +
          `- End with a short section called "GCSE Exam Tips" containing topic-relevant GCSE revision or exam tips.\n` +
          `- Do not use markdown tables or code fences.\n\n` +
          `Section notes:\n${chunkNotes.join("\n\n---\n\n")}`
      }
    ]
  });
}

async function runProcessing(
  videoUrl: string,
  userId: string,
  onProgress?: (state: Omit<ProcessTaskState, "status" | "video" | "error">) => void
) {
  const settings = await getUserSettings(userId);
  onProgress?.({
    stage: "transcript",
    detail: "Fetching the YouTube transcript",
    progress: 8
  });
  const transcriptData = await fetchVideoTranscript(videoUrl);

  const cached = await getProcessedVideoByVideoId(transcriptData.videoId, {
    minVersion: CURRENT_PROCESSING_VERSION
  });
  if (cached) {
    return cached;
  }

  onProgress?.({
    stage: "cleaning",
    detail: "Preparing transcript for cloud study mode",
    progress: 22
  });

  const cleanedTranscript = await refineTranscriptForStudy({
    endpoint: env.aiApiUrl,
    model: settings.model,
    accessToken: env.aiToken,
    rawTranscript: transcriptData.rawTranscript,
    onProgress: (detail, progress) =>
      onProgress?.({
        stage: "cleaning",
        detail,
        progress
      })
  });

  onProgress?.({
    stage: "notes",
    detail: "Generating revision notes",
    progress: 45
  });

  const notes = await generateDetailedNotes({
    endpoint: env.aiApiUrl,
    model: settings.model,
    accessToken: env.aiToken,
    cleanedTranscript,
    onProgress: (detail, progress) =>
      onProgress?.({
        stage: "notes",
        detail,
        progress
      })
  });

  onProgress?.({
    stage: "notes",
    detail: "Verifying note accuracy",
    progress: 66
  });

  let verifiedNotes = notes;

  try {
    const verificationQueries = await extractVerificationQueries({
      endpoint: env.aiApiUrl,
      model: settings.model,
      accessToken: env.aiToken,
      cleanedTranscript
    });
    const references = await collectVerificationReferences(verificationQueries);

    verifiedNotes = await verifyAndRefineNotes({
      endpoint: env.aiApiUrl,
      model: settings.model,
      accessToken: env.aiToken,
      cleanedTranscript,
      draftNotes: notes,
      references
    });
  } catch {
    verifiedNotes = notes;
  }

  const quizSource = prepareTranscriptForModel(cleanedTranscript, 5200);

  onProgress?.({
    stage: "mcq",
    detail: "Generating quiz questions",
    progress: 72
  });

  const quiz = await generateLessonQuiz({
    endpoint: env.aiApiUrl,
    model: settings.model,
    accessToken: env.aiToken,
    quizSource,
    onProgress: (detail, progress) =>
      onProgress?.({
        stage: progress < 70 ? "mcq" : "written",
        detail,
        progress: 70 + Math.round((progress / 100) * 18)
      })
  });

  onProgress?.({
    stage: "saving",
    detail: "Saving the study pack",
    progress: 94
  });

  return saveProcessedVideo({
    videoId: transcriptData.videoId,
    videoUrl,
    title: buildVideoTitle(transcriptData.videoId),
    rawTranscript: transcriptData.rawTranscript,
    cleanedTranscript,
    notes: verifiedNotes,
    quiz,
    processingVersion: CURRENT_PROCESSING_VERSION,
    transcriptLanguage: transcriptData.transcriptLanguage
  });
}

function createTaskId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function setTaskState(taskId: string, state: ProcessTaskState) {
  processTasks.set(taskId, state);
}

function updateTaskProgress(taskId: string, state: Omit<ProcessTaskState, "status" | "video" | "error">) {
  processTasks.set(taskId, {
    status: "running",
    stage: state.stage,
    detail: state.detail,
    progress: state.progress
  });
}

export async function GET(request: NextRequest) {
  const { user, response } = await requireApiUser();
  if (!user) {
    return response;
  }

  const taskId = request.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return apiError("A taskId is required.", 400);
  }

  const task = processTasks.get(taskId);
  if (!task) {
    return apiError("That processing task could not be found.", 404);
  }

  return NextResponse.json(task);
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

  const parsed = processSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Enter a valid YouTube URL.");
  }

  try {
    const transcriptData = await fetchVideoTranscript(parsed.data.videoUrl);
    const cached = await getProcessedVideoByVideoId(transcriptData.videoId, {
      minVersion: CURRENT_PROCESSING_VERSION
    });
    if (cached) {
      return NextResponse.json({ video: cached, cached: true, done: true });
    }

    const inFlight = processingCache.get(transcriptData.videoId);
    if (inFlight) {
      const taskId = createTaskId();
      setTaskState(taskId, {
        status: "running",
        stage: "waiting",
        detail: "Waiting for the current processing task to finish",
        progress: 5
      });

      inFlight
        .then((video) => {
          setTaskState(taskId, {
            status: "completed",
            stage: "completed",
            detail: "Study pack ready",
            progress: 100,
            video
          });
        })
        .catch((error) => {
          setTaskState(taskId, {
            status: "failed",
            stage: "failed",
            detail: "Processing failed",
            progress: 100,
            error: error instanceof Error ? error.message : "Unable to process this video."
          });
        });

      return NextResponse.json({ taskId, done: false, cached: false });
    }

    const taskId = createTaskId();
    setTaskState(taskId, {
      status: "running",
      stage: "queued",
      detail: "Preparing the cloud AI pipeline",
      progress: 2
    });

    const nextPromise = runProcessing(parsed.data.videoUrl, user.id, (state) => updateTaskProgress(taskId, state));
    processingCache.set(transcriptData.videoId, nextPromise);

    nextPromise
      .then((video) => {
        processingCache.delete(transcriptData.videoId);
        setTaskState(taskId, {
          status: "completed",
          stage: "completed",
          detail: "Study pack ready",
          progress: 100,
          video
        });
      })
      .catch((error) => {
        processingCache.delete(transcriptData.videoId);
        setTaskState(taskId, {
          status: "failed",
          stage: "failed",
          detail: "Processing failed",
          progress: 100,
          error: error instanceof Error ? error.message : "Unable to process this video."
        });
      });

    return NextResponse.json({ taskId, done: false, cached: false });
  } catch (error) {
    try {
      const transcriptData = await fetchVideoTranscript(parsed.data.videoUrl);
      processingCache.delete(transcriptData.videoId);
    } catch {
      return apiError(error instanceof Error ? error.message : "Unable to process this video.", 500);
    }

    return apiError(error instanceof Error ? error.message : "Unable to process this video.", 500);
  }
}
