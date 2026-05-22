import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fetchYouTubeTranscriptFromCaptions } from "@/lib/youtube-captions";

export const dynamic = "force-dynamic";

const transcriptRequestSchema = z.object({
  videoUrl: z.string().trim().min(1, "Paste a YouTube URL first.")
});

type BridgeTranscriptResponse = {
  videoId?: string;
  rawTranscript?: string;
  transcript?: string;
  text?: string;
  transcriptLanguage?: string;
  language?: string;
  provider?: string;
};

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function getTranscriptBridgeConfig() {
  return {
    url: process.env.TRANSCRIPT_BRIDGE_URL?.trim().replace(/\/$/, "") ?? "",
    token: process.env.TRANSCRIPT_BRIDGE_TOKEN?.trim() ?? ""
  };
}

function normalizeBridgePayload(payload: BridgeTranscriptResponse, videoUrl: string) {
  const text =
    payload.rawTranscript?.trim() ||
    payload.transcript?.trim() ||
    payload.text?.trim() ||
    "";

  if (!text) {
    throw new Error("The transcription service returned an empty transcript.");
  }

  return {
    videoUrl,
    videoId: payload.videoId || "",
    language: payload.transcriptLanguage || payload.language || "unknown",
    provider: payload.provider || "audio-transcription-bridge",
    text,
    segments: [],
    segmentCount: 0,
    characterCount: text.length
  };
}

async function fetchTranscriptFromBridge(videoUrl: string) {
  const bridge = getTranscriptBridgeConfig();
  if (!bridge.url) {
    throw new Error("TRANSCRIPT_BRIDGE_URL is not configured.");
  }

  const response = await fetch(`${bridge.url}/transcript`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(bridge.token ? { Authorization: `Bearer ${bridge.token}` } : {})
    },
    body: JSON.stringify({ videoUrl })
  });

  const payload = (await response.json().catch(() => null)) as BridgeTranscriptResponse | { error?: string; detail?: string } | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object"
        ? "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "detail" in payload && typeof payload.detail === "string"
            ? payload.detail
            : `Transcription service returned HTTP ${response.status}.`
        : `Transcription service returned HTTP ${response.status}.`;
    throw new Error(message);
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("The transcription service returned invalid JSON.");
  }

  return normalizeBridgePayload(payload as BridgeTranscriptResponse, videoUrl);
}

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse("The request payload was invalid. Refresh the page and try again.");
  }

  const parsed = transcriptRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? "Paste a YouTube URL first.");
  }

  try {
    const transcript = await fetchTranscriptFromBridge(parsed.data.videoUrl);

    return NextResponse.json(transcript);
  } catch (bridgeError) {
    try {
      const transcript = await fetchYouTubeTranscriptFromCaptions(parsed.data.videoUrl);

      return NextResponse.json({
        videoUrl: parsed.data.videoUrl,
        videoId: transcript.videoId,
        language: transcript.language,
        provider: transcript.provider,
        text: transcript.text,
        segments: transcript.segments,
        segmentCount: transcript.segments.length,
        characterCount: transcript.text.length
      });
    } catch (captionError) {
      const bridgeMessage = bridgeError instanceof Error ? bridgeError.message : "Audio transcription failed.";
      const captionMessage = captionError instanceof Error ? captionError.message : "Caption extraction failed.";

      return errorResponse(
        [
          "No transcript could be produced.",
          `Audio transcription: ${bridgeMessage}`,
          `Caption fallback: ${captionMessage}`
        ].join(" "),
        502
      );
    }
  }
}
