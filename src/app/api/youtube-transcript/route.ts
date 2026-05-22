import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fetchYouTubeTranscriptFromCaptions } from "@/lib/youtube-captions";

export const dynamic = "force-dynamic";

const transcriptRequestSchema = z.object({
  videoUrl: z.string().trim().min(1, "Paste a YouTube URL first.")
});

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
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
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : "Unable to fetch a transcript for this video.",
      502
    );
  }
}
