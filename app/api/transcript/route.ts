import { NextResponse } from "next/server";
import { getSubtitles } from "youtube-caption-extractor";

export const runtime = "nodejs"; 
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const videoUrl = body?.videoUrl;

    if (!videoUrl) {
      return NextResponse.json({ error: "Missing videoUrl" }, { status: 400 });
    }

    // Clean extraction of the 11-character video ID
    const match =
      videoUrl.match(/v=([^&]+)/) ||
      videoUrl.match(/youtu\.be\/([^?&]+)/);

    if (!match) {
      return NextResponse.json({ error: "Invalid YouTube URL format" }, { status: 400 });
    }

    const currentVideoId = match[1];

    try {
      // Fix: Use the correct parameter structure options: videoID with capital ID
      const subtitles = await getSubtitles({ videoID: currentVideoId, lang: "en" });

      if (!subtitles || subtitles.length === 0) {
        throw new Error("No captions returned");
      }

      const normalizedSubtitles = subtitles.map((item: any) => ({
        text: String(item.text || ""),
        start: Number(item.start || 0),
        duration: Number(item.dur || 2)
      }));

      return NextResponse.json({ subtitles: normalizedSubtitles, source: "primary" }, { status: 200 });

    } catch (primaryError) {
      console.warn("Primary scraper blocked or failed, attempting serverless mirror fallback...");

      try {
        // FALLBACK: Route through a proxy setup to shield the Oracle VPS IP footprint
        const fallbackUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(
          `https://youtube.com/watch?v=${currentVideoId}`
        )}`;
        
        const res = await fetch(fallbackUrl);
        const data = await res.json();
        const html = data.contents;

        // Extract tracking arrays straight out of the underlying watch page layout data strings
        const regex = /"captionTracks":\s*(\[.*?\])/;
        const parsedMatch = html.match(regex);

        if (!parsedMatch) {
          throw new Error("No caption tracks located inside player layout payload matrix.");
        }

        const tracks = JSON.parse(parsedMatch[1]);
        const englishTrack = tracks.find((t: any) => t.languageCode === "en") || tracks[0];

        if (!englishTrack || !englishTrack.baseUrl) {
          throw new Error("Target transcript translation data track is empty.");
        }

        // Fetch translation string context
        const xmlRes = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(englishTrack.baseUrl)}`);
        const xmlData = await xmlRes.json();
        const xmlHtml = xmlData.contents;

        const textRegex = /<text start="([\d.]+)" dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
        const fallbackSubtitles: any[] = [];
        let itemMatch;

        while ((itemMatch = textRegex.exec(xmlHtml)) !== null) {
          fallbackSubtitles.push({
            start: parseFloat(itemMatch[1]),
            duration: parseFloat(itemMatch[2]),
            text: itemMatch[3]
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
          });
        }

        if (fallbackSubtitles.length === 0) {
          throw new Error("Parsed fallback tracks returned empty arrays.");
        }

        return NextResponse.json({ subtitles: fallbackSubtitles, source: "backup-mirror" }, { status: 200 });

      } catch (fallbackError: any) {
        console.error("Both primary and secondary mirrors failed processing:", fallbackError.message);
        return NextResponse.json(
          { error: "YouTube security rules rejected the raw cloud instance scrape. Try again with a different video link." },
          { status: 500 }
        );
      }
    }
  } catch (err) {
    return NextResponse.json({ error: "Internal server error execution pipeline loop." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
