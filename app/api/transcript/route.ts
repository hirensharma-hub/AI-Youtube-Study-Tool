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

    // -------------------- TIMEDTEXT (Most Reliable Directly Native) --------------------
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
          
          // Check if data contains direct subtitle track entities
          if (data && data.subtitles && data.subtitles.length > 0) {
            // Find a usable webvtt translation file target
            const trackTarget = data.subtitles.find((s: any) => s.code === "en") || data.subtitles[0];
            
            if (trackTarget && trackTarget.url) {
              const vttRes = await fetch(trackTarget.url);
              if (vttRes.ok) {
                const vttText = await vttRes.text();
                
                // Fast-parse VTT file into clean text elements matching workspace mapping requirements
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
                        text: textLine.replace(/<[^>]*>/g, ""), // strip style tags
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

    // -------------------- LOCAL SCRIPT FALLBACK --------------------
    if (!subtitles) {
      try {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execFileP = promisify(execFile);

        const { stdout } = await execFileP("node", ["./scripts/fetchTranscript.js", videoId], {
          timeout: 20000
        });

        const parsed = JSON.parse(stdout || "{}");

        if (parsed.subtitles && parsed.subtitles.length > 0) {
          subtitles = parsed.subtitles.map((s: any) => ({
            text: s.text,
            start: s.start ?? s.offset ?? 0,
            duration: s.duration ?? 0
          }));
          workingInstance = parsed.source || "local-script";
        }
      } catch (e) {
        console.log("Local script fallback failed:", String(e));
      }
    }

    // -------------------- FINAL VALDIATION CHECK --------------------
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
