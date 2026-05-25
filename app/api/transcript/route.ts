import { NextResponse } from "next/server";
// Fix: Import it as a default module instead of a named structure
import getSubtitles from "youtube-caption-extractor";

export const runtime = "nodejs"; 
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const videoUrl = body?.videoUrl;

    if (!videoUrl) {
      return NextResponse.json({ error: "Missing videoUrl" }, { status: 400 });
    }

    // Extract the Video ID cleanly
    const match =
      videoUrl.match(/v=([^&]+)/) ||
      videoUrl.match(/youtu\.be\/([^?&]+)/);

    if (!match) {
      return NextResponse.json({ error: "Invalid YouTube URL format" }, { status: 400 });
    }

    const videoId = match[1];

    try {
      // Execute the default fetch function passing videoId and language parameters
      const subtitles = await getSubtitles({ videoId, lang: "en" });

      if (!subtitles || subtitles.length === 0) {
        return NextResponse.json(
          { error: "No English captions could be retrieved for this video layout." },
          { status: 400 }
        );
      }

      // Standardize the data mapping array back to your application format layout
      const normalizedSubtitles = subtitles.map((item: any) => ({
        text: String(item.text || ""),
        start: Number(item.start || 0),
        duration: Number(item.dur || item.duration || 2)
      }));

      return NextResponse.json(
        { subtitles: normalizedSubtitles, source: "caption-track-extractor" },
        { status: 200 }
      );

    } catch (e) {
      console.error("Caption extraction error context:", String(e));
      return NextResponse.json(
        { error: "YouTube security rules rejected the raw cloud instance scrape. Try again with a different video link." },
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
