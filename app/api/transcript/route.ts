import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";

const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.syncpundit.io",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.moomoo.me",
  "https://pipedapi.palveluntarjoaja.eu"
];

export async function POST(req: Request) {
  try {
    // 1. Authenticate user access using your database middleware
    const { user, response } = await requireApiUser();
    if (!user) {
      return response;
    }

    const body = await req.json().catch(() => ({}));
    const videoUrl = body?.videoUrl;

    if (!videoUrl) {
      return NextResponse.json({ error: "Missing videoUrl" }, { status: 400 });
    }

    // Extract video ID
    const match =
      videoUrl.match(/v=([^&]+)/) ||
      videoUrl.match(/youtu\.be\/([^?&]+)/);

    if (!match) {
      return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
    }

    const videoId = match[1];
    let subtitles: any[] | null = null;
    let workingInstance: string | null = null;

    // -------------------- TIMEDTEXT (Native Google Subtitles API) --------------------
    try {
      const listRes = await fetch(
        `https://video.google.com/timedtext?type=list&v=${videoId}`,
        { cache: "no-store" }
      );
      const listText = await listRes.text();

      if (listText.includes("<track")) {
        const langMatch = listText.match(/lang_code="([^"]+)"/);
        const lang = langMatch ? langMatch[1] : "en";

        const ttRes = await fetch(
          `https://video.google.com/timedtext?lang=${lang}&v=${videoId}`,
          { cache: "no-store" }
        );
        const ttText = await ttRes.text();

        if (ttText.includes("<text")) {
          const items: any[] = [];
          const re =
            /<text\s+start="([^"]+)"(?:\s+dur="([^"]+)")?[^>]*>([\s\S]*?)<\/text>/g;
          let m;

          while ((m = re.exec(ttText)) !== null) {
            const start = parseFloat(m[1]) || 0;
            const duration = m[2] ? parseFloat(m[2]) : 0;
            let text = m[3] || "";
            text = text
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/\+/g, " ");

            items.push({ text, start, duration });
          }

          if (items.length > 0) {
            subtitles = items;
            workingInstance = "youtube-timedtext";
          }
        }
      }
    } catch (err) {
      console.log("Timedtext engine bypassed:", String(err));
    }

    // -------------------- PIPED FALLBACK OVERRIDE --------------------
    if (!subtitles) {
      for (const instance of PIPED_INSTANCES) {
        try {
          const res = await fetch(`${instance}/streams/${videoId}`, {
            headers: { "User-Agent": "Mozilla/5.0" },
            cache: "no-store"
          });

          if (!res.ok) continue;

          const data = await res.json().catch(() => null);
          
          if (data && data.subtitles && data.subtitles.length > 0) {
            const trackTarget = data.subtitles.find((s: any) => s.code === "en") || data.subtitles[0];
            
            if (trackTarget && trackTarget.url) {
              const vttRes = await fetch(trackTarget.url);
              if (vttRes.ok) {
                const vttText = await vttRes.text();
                
                const items: any[] = [];
                const blocks = vttText.split("\n\n");
                
                for (const block of blocks) {
                  if (block.includes("-->")) {
                    const lines = block.split("\n");
                    const timeLine = lines[0];
                    const textLine = lines.slice(1).join(" ").trim();
                    
                    const timeMatch = timeLine.match(/(\d+):(\d+):(\d+)\.(\d+)/);
                    if (timeMatch) {
                      const startSecs = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
                      items.push({
                        text: textLine.replace(/<[^>]*>/g, ""),
                        start: startSecs,
                        duration: 2
                      });
                    }
                  }
                }
                
                if (items.length > 0) {
                  subtitles = items;
                  workingInstance = `${instance} (parsed-vtt)`;
                  break;
                }
              }
            }
          }
        } catch {}
      }
    }

    // -------------------- NATIVE YOUTUBE SCRAPER (Replaces child_process script) --------------------
    if (!subtitles) {
      try {
        const videoPageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
          cache: "no-store"
        });
        const html = await videoPageRes.text();
        
        const splittedHtml = html.split('"captionTracks":');
        if (splittedHtml.length > 1) {
          const videoDetails = splittedHtml[1].split(',"audioTracks"')[0];
          const tracks = JSON.parse(videoDetails || "[]");
          
          const englishTrack = tracks.find((t: any) => t.languageCode === "en") || tracks[0];
          if (englishTrack && englishTrack.baseUrl) {
            const finalTracksRes = await fetch(englishTrack.baseUrl, { cache: "no-store" });
            const xmlText = await finalTracksRes.text();
            
            const items: any[] = [];
            const re = /<text\s+start="([^"]+)"(?:\s+dur="([^"]+)")?[^>]*>([\s\S]*?)<\/text>/g;
            let m;

            while ((m = re.exec(xmlText)) !== null) {
              const start = parseFloat(m[1]) || 0;
              const duration = m[2] ? parseFloat(m[2]) : 0;
              let text = m[3] || "";
              text = text
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/\+/g, " ");

              items.push({ text, start, duration });
            }

            if (items.length > 0) {
              subtitles = items;
              workingInstance = "native-embedded-scraper";
            }
          }
        }
      } catch (e) {
        console.log("Native direct recovery system failed:", String(e));
      }
    }

    // -------------------- FINAL VALIDATION CHECK --------------------
    if (!subtitles || subtitles.length === 0) {
      return NextResponse.json(
        { error: "No subtitles found for this video. Captions may be disabled." },
        { status: 404 }
      );
    }

    // Normalize output fields array clean for workspace execution loop
    const normalizedSubtitles = subtitles.map((item: any) => ({
      text: String(item.text || ""),
      start: Number(item.start || 0),
      duration: Number(item.duration || item.dur || 0)
    }));

    return NextResponse.json(
      { subtitles: normalizedSubtitles, source: workingInstance },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error processing transcript payload" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
