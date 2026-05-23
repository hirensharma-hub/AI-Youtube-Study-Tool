export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.syncpundit.io",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.moomoo.me",
  "https://pipedapi.palveluntarjoaja.eu"
];

export async function POST(req: NextRequest) {
  try {
    const { videoUrl } = await req.json();

    if (!videoUrl) {
      return NextResponse.json({ error: "Missing videoUrl" }, { status: 400 });
    }

    // Extract video ID
    const match =
      videoUrl.match(/v=([^&]+)/) ||
      videoUrl.match(/youtu\.be\/([^?]+)/);

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
          headers: { "User-Agent": "Mozilla/5.0" }
        });

        if (!res.ok) continue;

        const data = await res.json();

        if (data.subtitles && data.subtitles.length > 0) {
          subtitles = data.subtitles;
          workingInstance = instance;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!subtitles) {
      return NextResponse.json(
        { error: "No subtitles found for this video." },
        { status: 404 }
      );
    }

    // Prefer English, otherwise first available
    const track =
      subtitles.find((s: any) => s.language === "English") ||
      subtitles[0];

    // Fetch subtitle file
    const subtitleRes = await fetch(track.url);
    const subtitleText = await subtitleRes.text();

    return NextResponse.json({
      videoId,
      transcript: subtitleText,
      language: track.language,
      source: workingInstance
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch transcript." },
      { status: 500 }
    );
  }
}
