import { NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";

export const runtime = "nodejs"; 
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const videoUrl = body?.videoUrl;

    if (!videoUrl) {
      return NextResponse.json({ error: "Missing videoUrl" }, { status: 400 });
    }

    // Extract the Video ID
    const match =
      videoUrl.match(/v=([^&]+)/) ||
      videoUrl.match(/youtu\.be\/([^?&]+)/);

    if (!match) {
      return NextResponse.json({ error: "Invalid YouTube URL format" }, { status: 400 });
    }

    const videoId = match[1];
    let subtitles: any[] = [];

    // Extract subtitles DIRECTLY on your Oracle server instance
    try {
      subtitles = await YoutubeTranscript.fetchTranscript(videoId);
    } catch (e) {
      console.error("Direct transcript extraction failed:", String(e));
      return NextResponse.json(
        { 
          error: "Could not retrieve transcripts natively. The video might lack captions, or YouTube is actively blocking this server's IP address." 
        },
        { status: 500 }
      );
    }

    // Verify data exists
    if (!subtitles || subtitles.length === 0) {
      return NextResponse.json(
        { error: "No subtitles found for this video." },
        { status: 400 }
      );
    }

    // Standardize structure for your frontend component maps
    const normalizedSubtitles = subtitles.map((item: any) => ({
      text: String(item.text || ""),
      start: Number(item.start || 0),
      duration: Number(item.duration || 2)
    }));

    return NextResponse.json(
      { subtitles: normalizedSubtitles, source: "native-server-extractor" },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error running transcript processor pipeline." },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
