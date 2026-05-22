export type YouTubeTranscriptSegment = {
  text: string;
  start: number;
  duration: number;
  lang?: string;
};

export type YouTubeTranscriptResult = {
  videoId: string;
  language: string;
  segments: YouTubeTranscriptSegment[];
  text: string;
  provider: "youtube-caption-tracks";
};

type CaptionTrack = {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
  name?: {
    simpleText?: string;
    runs?: Array<{ text?: string }>;
  };
};

type PlayerClient = {
  clientName: string;
  clientVersion: string;
  userAgent: string;
  thirdParty?: {
    embedUrl: string;
  };
};

const WATCH_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

const PLAYER_CLIENTS: PlayerClient[] = [
  {
    clientName: "ANDROID",
    clientVersion: "20.10.38",
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14)"
  },
  {
    clientName: "WEB",
    clientVersion: "2.20250418.01.00",
    userAgent: WATCH_USER_AGENT
  },
  {
    clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    clientVersion: "2.0",
    userAgent: WATCH_USER_AGENT,
    thirdParty: {
      embedUrl: "https://www.youtube.com"
    }
  }
];

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)));
}

function stripHtml(value: string) {
  return decodeXmlEntities(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function getCaptionTracksFromPlayerPayload(payload: any): CaptionTrack[] {
  const tracks = payload?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) ? tracks : [];
}

function chooseCaptionTrack(tracks: CaptionTrack[], preferredLanguage = "en") {
  if (!tracks.length) {
    return null;
  }

  return (
    tracks.find((track) => track.languageCode?.startsWith(preferredLanguage) && track.kind !== "asr") ??
    tracks.find((track) => track.kind !== "asr") ??
    tracks.find((track) => track.languageCode?.startsWith(preferredLanguage)) ??
    tracks[0]
  );
}

function parsePlayerResponseFromHtml(html: string) {
  const candidates = [
    /ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/,
    /["']PLAYER_RESPONSE["']\s*:\s*"((?:\\.|[^"])*)"/
  ];

  for (const pattern of candidates) {
    const match = html.match(pattern);
    if (!match) {
      continue;
    }

    try {
      if (pattern === candidates[0]) {
        return JSON.parse(match[1]);
      }

      return JSON.parse(JSON.parse(`"${match[1]}"`));
    } catch {
      continue;
    }
  }

  return null;
}

async function fetchPlayerPayload(videoId: string) {
  const errors: string[] = [];

  for (const client of PLAYER_CLIENTS) {
    try {
      const response = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": client.userAgent
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: client.clientName,
              clientVersion: client.clientVersion
            },
            ...(client.thirdParty ? { thirdParty: client.thirdParty } : {})
          },
          videoId
        })
      });

      if (!response.ok) {
        errors.push(`${client.clientName}: HTTP ${response.status}`);
        continue;
      }

      const payload = await response.json();
      const tracks = getCaptionTracksFromPlayerPayload(payload);
      if (tracks.length) {
        return payload;
      }

      const status = payload?.playabilityStatus?.status;
      errors.push(`${client.clientName}: no caption tracks${status ? ` (${status})` : ""}`);
    } catch (error) {
      errors.push(`${client.clientName}: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }

  throw new Error(`Could not fetch caption tracks from YouTube player clients. ${errors.join(" | ")}`);
}

async function fetchWatchPagePayload(videoId: string) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en&bpctr=9999999999&has_verified=1`, {
    headers: {
      "Accept-Language": "en-GB,en;q=0.9",
      "User-Agent": WATCH_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Watch page returned HTTP ${response.status}.`);
  }

  const html = await response.text();
  if (html.includes("g-recaptcha") || html.includes("consent.youtube.com")) {
    throw new Error("YouTube requested verification before serving the watch page.");
  }

  const payload = parsePlayerResponseFromHtml(html);
  if (!payload) {
    throw new Error("Could not read player response from the YouTube watch page.");
  }

  return payload;
}

async function fetchCaptionXml(track: CaptionTrack) {
  if (!track.baseUrl) {
    throw new Error("Caption track did not include a baseUrl.");
  }

  const captionUrl = new URL(track.baseUrl);
  if (!captionUrl.searchParams.has("fmt")) {
    captionUrl.searchParams.set("fmt", "srv3");
  }

  const response = await fetch(captionUrl.toString(), {
    headers: {
      "Accept-Language": "en-GB,en;q=0.9",
      "User-Agent": WATCH_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Caption track returned HTTP ${response.status}.`);
  }

  return response.text();
}

function normalizeSegments(segments: YouTubeTranscriptSegment[]) {
  return segments
    .map((segment) => ({
      ...segment,
      text: segment.text.replace(/\s+/g, " ").trim()
    }))
    .filter((segment) => segment.text.length > 0);
}

function parseCaptionXml(xml: string, lang: string) {
  const segments: YouTubeTranscriptSegment[] = [];

  for (const match of xml.matchAll(/<text start="([^"]*)" dur="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g)) {
    const text = stripHtml(match[3]);
    if (!text) {
      continue;
    }

    segments.push({
      text,
      duration: Number(match[2]),
      start: Number(match[1]),
      lang
    });
  }

  if (segments.length) {
    return segments;
  }

  for (const match of xml.matchAll(/<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    const segmentHtml = match[3];
    let text = "";

    for (const part of segmentHtml.matchAll(/<s[^>]*>([\s\S]*?)<\/s>/g)) {
      text += decodeXmlEntities(part[1]);
    }

    text = stripHtml(text || segmentHtml);
    if (!text) {
      continue;
    }

    segments.push({
      text,
      duration: Number(match[2]) / 1000,
      start: Number(match[1]) / 1000,
      lang
    });
  }

  return segments;
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

export async function fetchYouTubeTranscriptFromCaptions(videoUrl: string): Promise<YouTubeTranscriptResult> {
  const videoId = extractYouTubeVideoId(videoUrl);
  const errors: string[] = [];

  for (const loadPayload of [() => fetchPlayerPayload(videoId), () => fetchWatchPagePayload(videoId)]) {
    try {
      const payload = await loadPayload();
      const tracks = getCaptionTracksFromPlayerPayload(payload);
      const track = chooseCaptionTrack(tracks);
      if (!track) {
        errors.push("No usable caption tracks were available.");
        continue;
      }

      const language = track.languageCode || "unknown";
      const xml = await fetchCaptionXml(track);
      const segments = normalizeSegments(parseCaptionXml(xml, language));
      if (!segments.length) {
        errors.push("Caption XML did not contain transcript lines.");
        continue;
      }

      return {
        videoId,
        language,
        segments,
        text: segments.map((segment) => segment.text).join(" "),
        provider: "youtube-caption-tracks"
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Transcript fallback failed.");
    }
  }

  throw new Error(`No transcript could be retrieved for this video. ${errors.join(" | ")}`);
}
