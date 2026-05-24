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

    // Extract video ID cleanly
    const match =
      videoUrl.match(/v=([^&]+)/) ||
      videoUrl.match(/youtu\.be\/([^?&]+)/);

    if (!match) {
      return NextResponse.json({ error: "Invalid YouTube URL format" }, { status: 400 });
    }

    const videoId = match[1];
    let subtitles: any[] | null = null;
    let workingMethod: string | null = null;

    // METHOD 1: Try a high-availability production Piped API instance directly
    const primaryPipedAPI = "https://pipedapi.kavin.rocks";
    try {
      const res = await fetch(`${primaryPipedAPI}/streams/${videoId}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        cache: "no-store"
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.subtitles && data.subtitles.length > 0) {
          // Look for English or fall back to the first available track
          const trackTarget = data.subtitles.find((s: any) => s.code === "en" || s.code.startsWith("en")) || data.subtitles[0];
          
          if (trackTarget && trackTarget.url) {
            const vttRes = await fetch(trackTarget.url);
            if (vttRes.ok) {
              const vttText = await vttRes.text();
              const items: any[] = [];
              const blocks = vttText.split("\n\n");
              
              let indexCounter = 0;
              for (const block of blocks) {
                if (block.includes("-->")) {
                  const lines = block.split("\n");
                  const textLine = lines.slice(1).join(" ").trim();
                  
                  if (textLine) {
                    items.push({
                      text: textLine.replace(/<[^>]*>/g, ""), // strip any HTML tags
                      start: indexCounter * 3, // Safe fallback timing estimate
                      duration: 3
                    });
                    indexCounter++;
                  }
                }
              }
              
              if (items.length > 0) {
                subtitles = items;
                workingMethod = "piped-proxy-vtt";
              }
            }
          }
        }
      }
    } catch (err) {
      console.log("Method 1 proxy failed:", String(err));
    }

    // METHOD 2: Try direct fallback to a global alternative open transcript provider
    if (!subtitles) {
      try {
        const fallbackRes = await fetch(`https://subtitles-player.vercel.app/api/transcript?v=${videoId}`, {
          cache: "no-store"
        });
        if (fallbackRes.ok) {
          const data = await fallbackRes.json();
          if (data && data.subtitles) {
            subtitles = data.subtitles;
            workingMethod = "global-mirror-api";
          }
        }
      } catch (err) {
        console.log("Method 2 backup failed:", String(err));
      }
    }

    // If both completely failed due to network limits
    if (!subtitles || subtitles.length === 0) {
      return NextResponse.json(
        { error: "YouTube blocked the serverless extraction request. Please try another video or try again in a moment." },
        { status: 200 } // Swapped to 200 to give user clean feedback instead of a 404 crash
      );
    }

    const normalizedSubtitles = subtitles.map((item: any) => ({
      text: String(item.text || ""),
      start: Number(item.start || 0),
      duration: Number(item.duration || 2)
    }));

    return NextResponse.json(
      { subtitles: normalizedSubtitles, source: workingMethod },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error processing transcript code pipeline" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
