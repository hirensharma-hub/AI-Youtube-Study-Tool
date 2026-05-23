import { NextResponse } from "next/server";

const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.syncpundit.io",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.moomoo.me",
  "https://pipedapi.palveluntarjoaja.eu"
];

// IMPORTANT: DO NOT EXPORT runtime = "edge"
// This must run in Node serverless so child_process works.

export async function POST(req: Request) {
  try {
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

    // -------------------- PIPED --------------------
    for (const instance of PIPED_INSTANCES) {
      try {
        const res = await fetch(`${instance}/streams/${videoId}`, {
          headers: { "User-Agent": "Mozilla/5.0" },
          cache: "no-store"
        });

        if (!res.ok) continue;

        const data = await res.json().catch(() => null);
        if (data && data.subtitles && data.subtitles.length > 0) {
          subtitles = data.subtitles;
          workingInstance = instance;
          break;
        }
      } catch {}
    }

    // -------------------- TIMEDTEXT --------------------
    if (!subtitles) {
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
              const dur = m[2] ? parseFloat(m[2]) : 0;
              let text = m[3] || "";
              text = text
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/\+/g, " ");
              items.push({ start, dur, text });
            }

            if (items.length > 0) {
              subtitles = items;
              workingInstance = "youtube-timedtext";
            }
          }
        }
      } catch {}
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
          subtitles = parsed.subtitles;
          workingInstance = parsed.source || "local-script";
        }
      } catch (e) {
        console.log("Local script fallback failed:", String(e));
      }
    }

    // -------------------- FINAL CHECK --------------------
    if (!subtitles) {
      return NextResponse.json(
        { error: "No subtitles found for this video." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { subtitles, source: workingInstance },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
