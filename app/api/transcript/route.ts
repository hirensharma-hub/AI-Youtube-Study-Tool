import { NextResponse } from "next/server";
import { Innertube } from "youtubei.js";

export const runtime = "nodejs"; 
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const videoUrl = body?.videoUrl;

    if (!videoUrl) {
      return NextResponse.json({ error: "Missing videoUrl" }, { status: 400 });
    }

    // Extract Video ID
    const match =
      videoUrl.match(/v=([^&]+)/) ||
      videoUrl.match(/youtu\.be\/([^?&]+)/);

    if (!match) {
      return NextResponse.json({ error: "Invalid YouTube URL format" }, { status: 400 });
    }

    const videoId = match[1];

    try {
      // Initialize Innertube (Mimics an official client device handshake to bypass cloud IP blocks)
      const youtube = await Innertube.create();
      const videoInfo = await youtube.getInfo(videoId);
      
      // Fetch the transcript data structure natively
      const transcriptData = await videoInfo.getTranscript();
      
      // Extract the actual text segments
      const segments = transcriptData?.transcript?.content?.body?.initial_segments;

      if (!segments || segments.length === 0) {
        return NextResponse.json(
          { error: "This video does not have any available transcripts or closed captions." },
          { status: 400 }
        );
      }

      // Standardize the structure for your frontend application layout map
      const normalizedSubtitles = segments.map((item: any) => ({
        text: String(item.snippet?.text || item.text || ""),
        start: Number(item.start_ms ? item.start_ms / 1000 : 0),
        duration: Number(item.duration_ms ? item.duration_ms / 1000 : 2)
      }));

      return NextResponse.json(
        { subtitles: normalizedSubtitles, source: "youtubei-client-emulation" },
        { status: 200 }
      );

    } catch (e) {
      console.error("Innertube extraction node collapsed:", String(e));
      return NextResponse.json(
        { error: "YouTube security protocols rejected the server connection. Please try a different video or try again shortly." },
        { status: 500 }
      );
    }
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
