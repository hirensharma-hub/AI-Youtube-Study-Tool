import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { videoUrl } = await req.json();

    if (!videoUrl) {
      return NextResponse.json({ error: "Missing videoUrl" }, { status: 400 });
    }

    // Extract video ID
    const match = videoUrl.match(/v=([^&]+)/) || videoUrl.match(/youtu\.be\/([^?]+)/);
    if (!match) {
      return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
    }

    const videoId = match[1];

    // Use Piped API
    const pipedUrl = `https://pipedapi.kavin.rocks/captions/${videoId}`;

    const res = await fetch(pipedUrl, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Transcript unavailable for this video." },
        { status: 500 }
      );
    }

    const data = await res.json();

    if (!data || !data.subtitles || data.subtitles.length === 0) {
      return NextResponse.json(
        { error: "No subtitles found for this video." },
        { status: 404 }
      );
    }

    // Pick English or first available
    const track = data.subtitles.find((s: any) => s.language === "English") || data.subtitles[0];

    const transcriptRes = await fetch(track.url);
    const transcriptText = await transcriptRes.text();

    return NextResponse.json({
      videoId,
      transcript: transcriptText,
      language: track.language
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch transcript." },
      { status: 500 }
    );
  }
}
