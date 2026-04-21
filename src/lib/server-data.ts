import { ObjectId } from "mongodb";

import { providerCatalog } from "@/config/ai-providers";
import { getDatabase } from "@/lib/mongodb";
import { ProcessedVideo, QuizQuestion, UserSettings, ViewerUser } from "@/types";

export const CURRENT_PROCESSING_VERSION = 19;

const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  model: providerCatalog.ollama.defaultModel,
  temperature: 0.4,
  maxTokens: 1200
};

function toObjectId(value: string) {
  return new ObjectId(value);
}

function normalizeModel(model?: string) {
  if (!model) {
    return DEFAULT_SETTINGS.model;
  }

  const normalized = String(model).trim();
  const allowedModels = new Set(providerCatalog.ollama.modelSuggestions);

  if (!normalized) {
    return DEFAULT_SETTINGS.model;
  }

  if (allowedModels.has(normalized)) {
    return normalized;
  }

  if (
    normalized === "gpt-4o-mini" ||
    normalized === "gpt-4.1" ||
    normalized === "gpt-4.1-mini" ||
    normalized === "gpt-oss:120b" ||
    normalized === "gpt-oss:20b" ||
    normalized === "gpt-oss:20b-cloud" ||
    normalized.startsWith("llama") ||
    normalized.startsWith("qwen") ||
    normalized.startsWith("mistral") ||
    normalized.includes("/") ||
    normalized.startsWith("openai") ||
    normalized.startsWith("meta-llama") ||
    normalized.startsWith("mistralai") ||
    normalized.startsWith("Qwen")
  ) {
    return DEFAULT_SETTINGS.model;
  }

  return normalized;
}

function toProcessedVideo(doc: Record<string, any>): ProcessedVideo {
  return {
    id: doc._id.toString(),
    videoId: String(doc.videoId),
    videoUrl: String(doc.videoUrl),
    title: String(doc.title),
    rawTranscript: String(doc.rawTranscript),
    cleanedTranscript: String(doc.cleanedTranscript),
    notes: String(doc.notes),
    quiz: (doc.quiz ?? []) as QuizQuestion[],
    processingVersion: Number(doc.processingVersion ?? 1),
    transcriptLanguage: doc.transcriptLanguage ? String(doc.transcriptLanguage) : undefined,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString()
  };
}

export async function createUserAccount(input: {
  email: string;
  name: string;
  passwordHash: string;
}) {
  const db = await getDatabase();
  const now = new Date();
  const result = await db.collection("users").insertOne({
    email: input.email.toLowerCase(),
    name: input.name,
    passwordHash: input.passwordHash,
    createdAt: now,
    updatedAt: now
  });

  await db.collection("preferences").insertOne({
    userId: result.insertedId,
    ...DEFAULT_SETTINGS,
    createdAt: now,
    updatedAt: now
  });

  return {
    id: result.insertedId.toString(),
    email: input.email.toLowerCase(),
    name: input.name
  };
}

export async function findUserByEmail(email: string) {
  const db = await getDatabase();
  return db.collection("users").findOne({
    email: email.toLowerCase()
  });
}

export async function getUserSettings(userId: string): Promise<UserSettings> {
  const db = await getDatabase();
  const settings = await db.collection("preferences").findOne({
    userId: toObjectId(userId)
  });

  if (!settings) {
    return DEFAULT_SETTINGS;
  }

  return {
    theme: settings.theme ?? DEFAULT_SETTINGS.theme,
    model: normalizeModel(settings.model),
    temperature: Number(settings.temperature ?? DEFAULT_SETTINGS.temperature),
    maxTokens: Number(settings.maxTokens ?? DEFAULT_SETTINGS.maxTokens)
  };
}

export async function saveUserSettings(userId: string, settings: Partial<UserSettings>) {
  const db = await getDatabase();
  const current = await getUserSettings(userId);
  const nextSettings = {
    ...current,
    ...settings,
    model: normalizeModel(settings.model ?? current.model)
  };
  const now = new Date();

  await db.collection("preferences").updateOne(
    { userId: toObjectId(userId) },
    {
      $set: {
        theme: nextSettings.theme,
        model: nextSettings.model,
        temperature: nextSettings.temperature,
        maxTokens: nextSettings.maxTokens,
        updatedAt: now
      },
      $setOnInsert: {
        createdAt: now,
        userId: toObjectId(userId)
      }
    },
    { upsert: true }
  );

  return nextSettings;
}

export async function getProcessedVideoByVideoId(videoId: string, options?: { minVersion?: number }) {
  const db = await getDatabase();
  const doc = await db.collection("processedVideos").findOne({ videoId });

  if (!doc) {
    return null;
  }

  const video = toProcessedVideo(doc as Record<string, any>);
  if (options?.minVersion && video.processingVersion < options.minVersion) {
    return null;
  }

  return video;
}

export async function saveProcessedVideo(input: {
  videoId: string;
  videoUrl: string;
  title: string;
  rawTranscript: string;
  cleanedTranscript: string;
  notes: string;
  quiz: QuizQuestion[];
  processingVersion?: number;
  transcriptLanguage?: string;
}) {
  const db = await getDatabase();
  const now = new Date();

  await db.collection("processedVideos").updateOne(
    { videoId: input.videoId },
    {
      $set: {
        videoUrl: input.videoUrl,
        title: input.title,
        rawTranscript: input.rawTranscript,
        cleanedTranscript: input.cleanedTranscript,
        notes: input.notes,
        quiz: input.quiz,
        processingVersion: input.processingVersion ?? CURRENT_PROCESSING_VERSION,
        transcriptLanguage: input.transcriptLanguage,
        updatedAt: now
      },
      $setOnInsert: {
        createdAt: now,
        videoId: input.videoId
      }
    },
    { upsert: true }
  );

  return getProcessedVideoByVideoId(input.videoId);
}

export async function updateProcessedVideoQuiz(videoId: string, quiz: QuizQuestion[]) {
  const db = await getDatabase();
  const now = new Date();

  await db.collection("processedVideos").updateOne(
    { videoId },
    {
      $set: {
        quiz,
        updatedAt: now
      }
    }
  );

  return getProcessedVideoByVideoId(videoId);
}

export function sanitizeViewerUser(user: ViewerUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name
  };
}
