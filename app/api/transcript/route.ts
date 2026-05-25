import { NextResponse } from "next/server";
import { exec } from "child_process";
import util from "util";
import fs from "fs/promises";
import path from "path";

const execPromise = util.promisify(exec);

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
    const ytVideoUrl = `https://www.youtube.com/watch?v=${currentVideoId}`;
    const outputFilename = `transcript_${currentVideoId}`;
    const outputPath = path.join("/tmp", outputFilename);

    // Command to securely gather subtitles using official application simulation arguments
    const command = `yt-dlp --skip-download --write-auto-subs --write-subs --sub-lang en --output "${outputPath}" "${ytVideoUrl}"`;
    
    await execPromise(command);

    const expectedFilePath = `${outputPath}.en.vtt`;

    try {
      const rawTranscript = await fs.readFile(expectedFilePath, "utf-8");
      
      // Clean up the temporary track file from the disk right away
      await fs.unlink(expectedFilePath).catch(() => {});

      const subtitles: Array<{ text: string; start: number; duration: number }> = [];
      
      // Breakdown lines using clean regex mapping matching WebVTT structured timestamps
      const blockRegex = /(\d\d:\d\d:\d\d\.\d\d\d) --> (\d\d:\d\d:\d\d\.\d\d\d).*\n([\s\S]*?)(?=\n\d\d:\d\d:\d\d\.\d\d\d|\n\n|$)/g;
      let blockMatch;

      while ((blockMatch = blockRegex.exec(rawTranscript)) !== null) {
        const startTimeStr = blockMatch[1];
        const endTimeStr = blockMatch[2];
        const rawText = blockMatch[3];

        // Convert timestamp strings (HH:MM:SS.mmm) into numerical seconds
        const parseSeconds = (tStr: string) => {
          const parts = tStr.split(":");
          const hrs = parseFloat(parts[0]);
          const mins = parseFloat(parts[1]);
          const secs = parseFloat(parts[2]);
          return (hrs * 3600) + (mins * 60) + secs;
        };

        const start = parseSeconds(startTimeStr);
        const end = parseSeconds(endTimeStr);
        const duration = Math.max(0.1, end - start);

        // Sanitize styling data attributes and back-to-back caption duplication loops
        const text = rawText
          .replace(/<[^>]*>/g, "")
          .split("\n")
          .map(line => line.trim())
          .filter(line => line !== "")
          .join(" ");

        if (text) {
          subtitles.push({ text, start, duration });
        }
      }

      if (subtitles.length === 0) {
        throw new Error("Parsed tracking tracks returned empty arrays.");
      }

      // Return identical schema signature format to perfectly satisfy your application components
      return NextResponse.json({ subtitles, source: "yt-dlp-secure" }, { status: 200 });

    } catch (fileError) {
      return NextResponse.json({ error: "Transcript tracks not found for this video." }, { status: 404 });
    }

  } catch (err: any) {
    console.error("Backend compilation error sequence:", err.message);
    return NextResponse.json({ error: "Internal server error execution pipeline loop." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
