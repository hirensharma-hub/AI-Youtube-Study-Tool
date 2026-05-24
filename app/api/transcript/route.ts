import { NextResponse } from "next/server";

export const runtime = "nodejs"; 
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const videoUrl = body?.videoUrl;

    if (!videoUrl) {
      return NextResponse.json({ error: "Missing videoUrl" }, { status: 400 });
    }

    const match =
      videoUrl.match(/v=([^&]+)/) ||
      videoUrl.match(/youtu\.be\/([^?&]+)/);

    if (!match) {
      return NextResponse.json({ error: "Invalid YouTube URL format" }, { status: 400 });
    }

    const videoId = match[1];
    let subtitles: any[] | null = null;
    let workingMethod = "";

    // ULTRA-RESILLIENT METHOD: Use a highly available specialized YouTube Subtitle Decrypter API
    try {
      const res = await fetch(`https://youtube-subtitles-api.onrender.com/transcript?v=${videoId}`, {
        cache: "no-store"
      });
      
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.subtitles && data.subtitles.length > 0) {
          subtitles = data.subtitles;
          workingMethod = "subtitles-decrypter-api";
        }
      }
    } catch (e) {
      console.log("Primary API layer failed:", String(e));
    }

    // FALLBACK METHOD: Try pulling through an alternative unblocked mirror
    if (!subtitles) {
      try {
        const fallbackRes = await fetch(`https://subtitles-player.vercel.app/api/transcript?v=${videoId}`, {
          cache: "no-store"
        });
        if (fallbackRes.ok) {
          const data = await fallbackRes.json().catch(() => null);
          if (data && data.subtitles) {
            subtitles = data.subtitles;
            workingMethod = "global-mirror-api";
          }
        }
      } catch (err) {
        console.log("Fallback mirror failed:", String(err));
      }
    }

    // If all extraction nodes are blocked by YouTube
    if (!subtitles || subtitles.length === 0) {
      return NextResponse.json(
        { error: "YouTube's rate-limiter is actively blocking this serverless region. Please try again in 30 seconds or try a different video link." },
        { status: 200 }
      );
    }

    // Standardize structure for the frontend map function
    const normalizedSubtitles = subtitles.map((item: any) => ({
      text: String(item.text || ""),
      start: Number(item.start || 0),
      duration: Number(item.duration || item.dur || 2)
    }));

    return NextResponse.json(
      { subtitles: normalizedSubtitles, source: workingMethod },
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
