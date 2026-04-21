import { YoutubeTranscript } from "youtube-transcript";

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractYouTubeVideoId(input: string) {
  const trimmed = input.trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid YouTube URL.");
  }

  const hostname = url.hostname.replace(/^www\./, "");

  if (hostname === "youtu.be") {
    const pathId = url.pathname.split("/").filter(Boolean)[0];
    if (pathId) {
      return safeDecode(pathId);
    }
  }

  if (hostname === "youtube.com" || hostname === "m.youtube.com") {
    const watchId = url.searchParams.get("v");
    if (watchId) {
      return safeDecode(watchId);
    }

    const segments = url.pathname.split("/").filter(Boolean);
    const candidate = segments[1];
    if ((segments[0] === "embed" || segments[0] === "shorts") && candidate) {
      return safeDecode(candidate);
    }
  }

  throw new Error("Could not extract a YouTube video ID from that URL.");
}

export async function fetchVideoTranscript(videoUrl: string) {
  const videoId = extractYouTubeVideoId(videoUrl);
  const transcript = await Promise.race([
    YoutubeTranscript.fetchTranscript(videoId),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Transcript fetching timed out for this video.")), 20000);
    })
  ]);

  if (!transcript.length) {
    throw new Error("No transcript was found for this video.");
  }

  return {
    videoId,
    transcriptLanguage: transcript[0]?.lang,
    rawTranscript: transcript.map((entry) => entry.text.replace(/\s+/g, " ").trim()).join(" ")
  };
}
