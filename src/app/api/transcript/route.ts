import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { apiError, parseJsonBody, requireApiUser } from "@/lib/api";
import { extractYouTubeVideoId, fetchVideoTranscript } from "@/lib/youtube";

const transcriptRequestSchema = z.object({
  videoUrl: z.string().trim().url()
});

export async function POST(request: NextRequest) {
  // Require user authentication (your existing logic)
  const { user, response } = await requireApiUser();
  if (!user) {
    return response;
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await parseJsonBody(request);
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "The request payload was invalid.",
      400
    );
  }

  // Validate input
  const parsed = transcriptRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("A valid YouTube URL is required.");
  }

  try {
    // Extract ID
    const videoId = extractYouTubeVideoId(parsed.data.videoUrl);

    // Fetch transcript (server-side, no CORS issues)
    const transcript = await fetchVideoTranscript(parsed.data.videoUrl);

    return NextResponse.json({
      videoUrl: parsed.data.videoUrl,
      videoId,
      transcript
    });
  } catch (error) {
    return apiError(
      error instanceof Error ? error.message : "Unable to fetch a transcript for this video.",
      500
    );
  }
}
