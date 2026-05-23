import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { videoUrl } = await req.json();

    if (!videoUrl) {
      return NextResponse.json({ error: "Missing videoUrl" }, { status: 400 });
    }

    // Extract video ID
    const match =
      videoUrl.match(/v=([^&]+)/) ||
      videoUrl.match(/youtu\.be\/([^?]+)/);

    if (!match) {
      return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
    }

    const videoId = match[1];

    // Fetch stream info from Piped
    const pipedUrl = `https://pipedapi.kavin.rocks/streams/${videoId}`;
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

    if (!data.subtitles || data.subtitles.length === 0) {
      return NextResponse.json(
        { error: "No subtitles found for this video." },
        { status: 404 }
      );
    }

    // Prefer English, otherwise first available
    const track =
      data.subtitles.find((s: any) => s.language === "English") ||
      data.subtitles[0];

    // Fetch subtitle file
    const subtitleRes = await fetch(track.url);
    const subtitleText = await subtitleRes.text();

    return NextResponse.json({
      videoId,
      transcript: subtitleText,
      language: track.language
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch transcript." },
      { status: 500 }
    );
  }
}
