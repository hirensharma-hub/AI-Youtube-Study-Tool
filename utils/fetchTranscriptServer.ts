// utils/fetchTranscriptServer.ts
import { extractVideoId } from "./extractVideoId";

export async function fetchTranscriptServer(videoUrl: string) {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) throw new Error("Invalid YouTube URL");

  const fetchOptions: RequestInit = {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
    next: { revalidate: 3600 }, // Cache transcripts for 1 hour to prevent rate limiting
  };

  // 1. Fetch available subtitle tracks
  const listUrl = `https://video.google.com/timedtext?type=list&v=${videoId}`;
  const listResponse = await fetch(listUrl, fetchOptions);
  if (!listResponse.ok) throw new Error(`YouTube metadata endpoint responded with status: ${listResponse.status}`);
  
  const listXml = await listResponse.text();
  if (!listXml.includes("<track")) {
    throw new Error("No subtitle tracks available for this video (YouTube might be restricting the request)");
  }

  // 2. Pick the first language (usually "en")
  const langMatch = listXml.match(/lang_code="([^"]+)"/);
  const lang = langMatch ? langMatch[1] : "en";

  // 3. Fetch the actual subtitles
  const subsUrl = `https://video.google.com/timedtext?lang=${lang}&v=${videoId}`;
  const subsResponse = await fetch(subsUrl, fetchOptions);
  if (!subsResponse.ok) throw new Error(`Failed to retrieve subtitle XML for language: ${lang}`);

  const subsXml = await subsResponse.text();
  if (!subsXml.includes("<text")) throw new Error("No subtitles found for this video");

  // 4. Parse XML into JSON
  const segments: { start: number; dur: number; text: string }[] = [];
  const re = /<text start="([^"]+)" dur="([^"]*)">([\s\S]*?)<\/text>/g;

  let m;
  while ((m = re.exec(subsXml)) !== null) {
    const start = parseFloat(m[1]);
    const dur = parseFloat(m[2] || "0");
    let text = m[3];

    text = text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\+/g, " ");

    segments.push({ start, dur, text });
  }

  const fullText = segments.map((s) => s.text).join(" ");

  return {
    videoId,
    language: lang,
    provider: "youtube-timedtext-server",
    text: fullText,
    segments,
    segmentCount: segments.length,
    characterCount: fullText.length,
  };
}
