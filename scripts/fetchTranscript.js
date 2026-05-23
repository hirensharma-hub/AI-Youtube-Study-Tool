#!/usr/bin/env node
/**
 * fetchTranscript.js
 *
 * Usage:
 *   node scripts/fetchTranscript.js 6Af6b_wyiwI
 *
 * Output:
 *   JSON printed to stdout: { subtitles: [...], source: "piped|youtube-timedtext|youtube-transcript" }
 *
 * Notes:
 * - Requires Node 18+ (global fetch).
 * - Optional dependency: youtube-transcript (install with `npm install youtube-transcript`) for the JS fallback.
 * - Some videos are restricted and will not expose timedtext or transcript.
 */

const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.syncpundit.io",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.moomoo.me",
  "https://pipedapi.palveluntarjoaja.eu"
];

async function tryPiped(videoId) {
  for (const instance of PIPED_INSTANCES) {
    try {
      const url = `${instance}/streams/${videoId}`;
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      if (data && Array.isArray(data.subtitles) && data.subtitles.length > 0) {
        const normalized = data.subtitles.map(s => ({
          start: Number(s.start ?? s.offset ?? 0),
          dur: Number(s.dur ?? s.duration ?? 0),
          text: String(s.text ?? s.content ?? "")
        }));
        return { subtitles: normalized, source: instance };
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

async function tryTimedtext(videoId) {
  try {
    const listRes = await fetch(`https://video.google.com/timedtext?type=list&v=${videoId}`, { cache: "no-store" });
    const listText = await listRes.text();
    if (!listText || !listText.includes("<track")) return null;

    const langMatch = listText.match(/lang_code="([^"]+)"/);
    const lang = langMatch ? langMatch[1] : "en";
    const ttRes = await fetch(`https://video.google.com/timedtext?lang=${lang}&v=${videoId}`, { cache: "no-store" });
    const ttText = await ttRes.text();
    if (!ttText || !ttText.includes("<text")) return null;

    const items = [];
    const re = /<text\s+start="([^"]+)"(?:\s+dur="([^"]+)")?[^>]*>([\s\S]*?)<\/text>/g;
    let m;
    while ((m = re.exec(ttText)) !== null) {
      const start = parseFloat(m[1]) || 0;
      const dur = m[2] ? parseFloat(m[2]) : 0;
      let text = m[3] || "";
      text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      text = text.replace(/\+/g, " ");
      items.push({ start, dur, text });
    }
    if (items.length === 0) return null;
    return { subtitles: items, source: `youtube-timedtext(${lang})` };
  } catch (e) {
    return null;
  }
}

async function tryYoutubeTranscriptPackage(videoId) {
  try {
    const mod = await import("youtube-transcript").catch(() => null);
    if (!mod || typeof mod.getTranscript !== "function") return null;
    const transcript = await mod.getTranscript(videoId).catch(() => null);
    if (!transcript || transcript.length === 0) return null;
    const items = transcript.map(t => ({
      start: Number(t.offset ?? 0),
      dur: Number(t.duration ?? 0),
      text: String(t.text ?? "")
    }));
    return { subtitles: items, source: "youtube-transcript" };
  } catch (e) {
    return null;
  }
}

async function fetchTranscript(videoId) {
  if (!videoId) throw new Error("Missing videoId");

  const piped = await tryPiped(videoId);
  if (piped) return piped;

  const timed = await tryTimedtext(videoId);
  if (timed) return timed;

  const ytpkg = await tryYoutubeTranscriptPackage(videoId);
  if (ytpkg) return ytpkg;

  return null;
}

async function main() {
  const videoId = process.argv[2];
  if (!videoId) {
    console.error("Usage: node scripts/fetchTranscript.js VIDEO_ID");
    process.exit(2);
  }

  try {
    const result = await fetchTranscript(videoId);
    if (!result) {
      console.log(JSON.stringify({ error: "No subtitles found for this video." }));
      process.exit(0);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ error: String(err) }));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
