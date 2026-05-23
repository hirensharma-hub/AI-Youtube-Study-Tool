import { extractVideoId } from "./extractVideoId";

export async function fetchTranscriptClient(videoUrl: string) {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) throw new Error("Invalid YouTube URL");

  // 1. Fetch available subtitle tracks
  const listUrl = `https://video.google.com/timedtext?type=list&v=${videoId}`;
  const listXml = await fetch(listUrl).then((r) => r.text());

  if (!listXml.includes("<track")) {
    throw new Error("No subtitle tracks available");
  }

  // 2. Pick the first language (usually "en")
  const langMatch = listXml.match(/lang_code="([^"]+)"/);
  const lang = langMatch ? langMatch[1] : "en";

  // 3. Fetch the actual subtitles
  const subsUrl = `https://video.google.com/timedtext?lang=${lang}&v=${videoId}`;
  const subsXml = await fetch(subsUrl).then((r) => r.text());

  if (!subsXml.includes("<text")) {
    throw new Error("No subtitles found for this video");
  }

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
    provider: "youtube-timedtext",
    text: fullText,
    segments,
    segmentCount: segments.length,
    characterCount: fullText.length,
  };
}
