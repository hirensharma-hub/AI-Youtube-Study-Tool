import { NextResponse } from "next/server";

const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.syncpundit.io",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.moomoo.me",
  "https://pipedapi.palveluntarjoaja.eu"
];

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const videoUrl = body?.videoUrl;
    if (!videoUrl) {
      return NextResponse.json({ error: "Missing videoUrl" }, { status: 400 });
    }

    // Extract video ID (supports standard and youtu.be)
    const match =
      videoUrl.match(/v=([^&]+)/) ||
      videoUrl.match(/youtu\.be\/([^?&]+)/);

    if (!match) {
      return NextResponse.json({ error: "Invalid YouTube URL" }, { status: 400 });
    }

    const videoId = match[1];

    let subtitles: any[] | null = null;
    let workingInstance: string | null = null;

    // Try multiple Piped servers
    for (const instance of PIPED_INSTANCES) {
      try {
        const res = await fetch(`${instance}/streams/${videoId}`, {
          headers: { "User-Agent": "Mozilla/5.0" },
          cache: "no-store"
        });

        if (!res.ok) {
          console.log(`Piped instance ${instance} returned status ${res.status}`);
          continue;
        }

        const data = await res.json().catch(() => null);
        if (data && data.subtitles && data.subtitles.length > 0) {
          subtitles = data.subtitles;
          workingInstance = instance;
          console.log(`Found subtitles from Piped instance: ${instance}`);
          break;
        } else {
          console.log(`Piped instance ${instance} has no subtitles`);
        }
      } catch (err) {
        console.log(`Error querying ${instance}:`, String(err));
        continue;
      }
    }

    // Timedtext fallback
    if (!subtitles) {
      try {
        console.log("Attempting YouTube timedtext fallback for", videoId);
        const listRes = await fetch(`https://video.google.com/timedtext?type=list&v=${videoId}`, { cache: "no-store" });
        const listText = await listRes.text();
        if (listText && listText.includes('<track')) {
          const langMatch = listText.match(/lang_code="([^"]+)"/);
          const lang = langMatch ? langMatch[1] : 'en';
          const ttRes = await fetch(`https://video.google.com/timedtext?lang=${lang}&v=${videoId}`, { cache: "no-store" });
          const ttText = await ttRes.text();
          if (ttText && ttText.includes('<text')) {
            const items: any[] = [];
            const re = /<text\s+start="([^"]+)"(?:\s+dur="([^"]+)")?[^>]*>([\s\S]*?)<\/text>/g;
            let m;
            while ((m = re.exec(ttText)) !== null) {
              const start = parseFloat(m[1]) || 0;
              const dur = m[2] ? parseFloat(m[2]) : 0;
              let text = m[3] || "";
              text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
              text = text.replace(/\+/g, ' ');
              items.push({ start, dur, text });
            }
            if (items.length > 0) {
              subtitles = items;
              workingInstance = 'youtube-timedtext';
              console.log(`Found subtitles from YouTube timedtext (lang=${lang})`);
            } else {
              console.log("Timedtext returned no <text> nodes");
            }
          } else {
            console.log("Timedtext fetch returned empty for chosen language");
          }
        } else {
          console.log("No timedtext tracks listed for this video");
        }
      } catch (e) {
        console.log("Timedtext fallback error:", String(e));
      }
    }

    // -------------------- Local script fallback (server runtime only) --------------------
    if (!subtitles) {
      try {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execFileP = promisify(execFile);

        const { stdout } = await execFileP("node", ["./scripts/fetchTranscript.js", videoId], {
          timeout: 20000
        });

        let parsed = {};
        try {
          parsed = JSON.parse(stdout || "{}");
        } catch (parseErr) {
          console.log("Local script JSON parse error:", String(parseErr));
        }

        if (parsed && Array.isArray(parsed.subtitles) && parsed.subtitles.length > 0) {
          subtitles = parsed.subtitles;
          workingInstance = parsed.source || "local-script";
          console.log("Found subtitles via local script fallback:", workingInstance);
        } else {
          console.log("Local script returned no subtitles");
        }
      } catch (e) {
        console.log("Local script fallback failed:", String(e));
      }
    }
    // ------------------------------------------------------------------------------------

    if (!subtitles) {
      return NextResponse.json(
        { error: "No subtitles found for this video." },
        { status: 404 }
      );
    }

    return NextResponse.json({ subtitles, source: workingInstance }, { status: 200 });
  } catch (err) {
    console.log("Transcript route unexpected error:", String(err));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
