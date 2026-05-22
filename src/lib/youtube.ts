import { YoutubeTranscript } from "youtube-transcript";

import { env } from "@/lib/env";

type TranscriptPayload = {
  videoId: string;
  rawTranscript: string;
  transcriptLanguage?: string;
  provider?: string;
};

type TranscriptEntry = {
  text: string;
  duration: number;
  offset: number;
  lang?: string;
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

type TranscriptProvider = {
  id: string;
  fetch: (input: { videoId: string; videoUrl: string }) => Promise<TranscriptPayload>;
};

type TranscriptCacheEntry =
  | {
      ok: true;
      expiresAt: number;
      value: TranscriptPayload;
    }
  | {
      ok: false;
      expiresAt: number;
      error: string;
    };

declare global {
  // eslint-disable-next-line no-var
  var __studyTranscriptCache: Map<string, TranscriptCacheEntry> | undefined;
}

const transcriptCache = globalThis.__studyTranscriptCache ?? new Map<string, TranscriptCacheEntry>();

if (!globalThis.__studyTranscriptCache) {
  globalThis.__studyTranscriptCache = transcriptCache;
}

const SUCCESS_CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const FAILURE_CACHE_TTL_MS = 1000 * 60 * 5;

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripHtml(value: string) {
  return decodeXmlEntities(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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

function normalizeTranscriptEntries(entries: TranscriptEntry[]) {
  return entries
    .map((entry) => ({
      text: entry.text.replace(/\s+/g, " ").trim(),
      duration: entry.duration,
      offset: entry.offset,
      lang: entry.lang
    }))
    .filter((entry) => entry.text.length > 0);
}

function getCaptionTracksFromPlayerPayload(payload: any): CaptionTrack[] {
  const tracks = payload?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) ? tracks : [];
}

function chooseCaptionTrack(tracks: CaptionTrack[]) {
  if (!tracks.length) {
    return null;
  }

  return (
    tracks.find((track) => track.languageCode?.startsWith("en") && track.kind !== "asr") ??
    tracks.find((track) => track.kind !== "asr") ??
    tracks.find((track) => track.languageCode?.startsWith("en")) ??
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

async function fetchWatchPageTranscript(videoId: string) {
  const url = `https://www.youtube.com/watch?v=${videoId}&hl=en&bpctr=9999999999&has_verified=1`;
  const response = await fetch(url, {
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

function parseCaptionXml(xml: string, lang: string) {
  const entries: TranscriptEntry[] = [];

  for (const match of xml.matchAll(/<text start="([^"]*)" dur="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g)) {
    const text = stripHtml(match[3]);
    if (!text) {
      continue;
    }

    entries.push({
      text,
      duration: Number(match[2]),
      offset: Number(match[1]),
      lang
    });
  }

  if (entries.length) {
    return entries;
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

    entries.push({
      text,
      duration: Number(match[2]) / 1000,
      offset: Number(match[1]) / 1000,
      lang
    });
  }

  return entries;
}

async function fetchTranscriptFromCaptionTracks(videoId: string) {
  const errors: string[] = [];

  for (const loadPayload of [() => fetchPlayerPayload(videoId), () => fetchWatchPageTranscript(videoId)]) {
    try {
      const payload = await loadPayload();
      const tracks = getCaptionTracksFromPlayerPayload(payload);
      const track = chooseCaptionTrack(tracks);
      if (!track) {
        errors.push("No usable caption tracks were available.");
        continue;
      }

      const lang = track.languageCode || "en";
      const xml = await fetchCaptionXml(track);
      const entries = normalizeTranscriptEntries(parseCaptionXml(xml, lang));
      if (entries.length) {
        return {
          videoId,
          transcriptLanguage: lang,
          rawTranscript: entries.map((entry) => entry.text).join(" "),
          provider: "youtube-caption-tracks"
        };
      }

      errors.push("Caption XML did not contain transcript lines.");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Transcript fallback failed.");
    }
  }

  throw new Error(`No transcript could be retrieved for this video. ${errors.join(" | ")}`);
}

async function fetchTranscriptFromExternalBridge(videoUrl: string) {
  if (!env.transcriptBridgeUrl) {
    throw new Error("External transcript bridge is not configured.");
  }

  let response: Response;

  try {
    response = await fetch(`${env.transcriptBridgeUrl.replace(/\/$/, "")}/transcript`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.transcriptBridgeToken ? { Authorization: `Bearer ${env.transcriptBridgeToken}` } : {})
      },
      body: JSON.stringify({ videoUrl })
    });
  } catch (error) {
    throw new Error(
      `The external transcript bridge could not be reached at ${env.transcriptBridgeUrl}. ` +
        `Check that the Oracle service is running, port 4318 is open, and the URL is correct.`
    );
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      payload && typeof payload === "object"
        ? typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : typeof (payload as { detail?: unknown }).detail === "string"
            ? (payload as { detail: string }).detail
            : `Transcript bridge returned HTTP ${response.status}.`
        : `Transcript bridge returned HTTP ${response.status}.`;
    throw new Error(message);
  }

  const payload = (await response.json()) as {
    videoId?: string;
    rawTranscript?: string;
    transcriptLanguage?: string;
  };

  if (!payload.videoId || !payload.rawTranscript?.trim()) {
    throw new Error("Transcript bridge returned an invalid transcript payload.");
  }

  return {
    videoId: payload.videoId,
    rawTranscript: payload.rawTranscript,
    transcriptLanguage: payload.transcriptLanguage,
    provider: "external-bridge"
  };
}

async function fetchTranscriptFromCommunityApi(videoUrl: string) {
  const baseUrl = env.communityTranscriptApiUrl.trim().replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("Community transcript API is not configured.");
  }

  let response: Response;

  try {
    response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        video_url: videoUrl
      })
    });
  } catch {
    throw new Error("Community transcript API could not be reached right now.");
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        transcript?: Array<{ text?: string; start?: number; duration?: number }>;
        video_id?: string;
        error?: string;
        detail?: string;
      }
    | null;

  if (!response.ok) {
    const message =
      payload?.error ||
      payload?.detail ||
      `Community transcript API returned HTTP ${response.status}.`;
    throw new Error(message);
  }

  const transcriptEntries = Array.isArray(payload?.transcript) ? payload.transcript : [];
  const rawTranscript = transcriptEntries
    .map((entry) => (typeof entry?.text === "string" ? entry.text.replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean)
    .join(" ");

  if (!rawTranscript) {
    throw new Error("Community transcript API returned an empty transcript.");
  }

  return {
    videoId: payload?.video_id?.trim() || extractYouTubeVideoId(videoUrl),
    rawTranscript,
    provider: "community-transcript-api"
  };
}

async function fetchTranscriptFromTubeText(videoId: string) {
  const baseUrl = env.tubeTextApiUrl.replace(/\/$/, "");
  let response: Response;

  try {
    response = await fetch(`${baseUrl}/youtube/transcript?video_id=${encodeURIComponent(videoId)}`, {
      headers: {
        Accept: "application/json"
      }
    });
  } catch (error) {
    throw new Error("TubeText could not be reached right now.");
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        success?: boolean;
        data?: {
          video_id?: string;
          full_text?: string;
          transcript?: string[];
        };
        error?: string;
        message?: string;
      }
    | null;

  if (!response.ok || !payload?.success) {
    const message =
      payload?.error ||
      payload?.message ||
      `TubeText returned HTTP ${response.status}.`;
    throw new Error(message);
  }

  const rawTranscript =
    payload.data?.full_text?.trim() ||
    (Array.isArray(payload.data?.transcript) ? payload.data?.transcript.join(" ").trim() : "");

  if (!rawTranscript) {
    throw new Error("TubeText returned an empty transcript.");
  }

  return {
    videoId: payload.data?.video_id?.trim() || videoId,
    rawTranscript,
    transcriptLanguage: "unknown",
    provider: "tubetext"
  };
}

async function fetchTranscriptFromYoutubeTranscriptLib(videoId: string) {
  const transcript = await Promise.race([
    YoutubeTranscript.fetchTranscript(videoId),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Transcript fetching timed out for this video.")), 20000);
    })
  ]);

  if (!transcript.length) {
    throw new Error("The YouTube transcript library returned no transcript lines.");
  }

  return {
    videoId,
    transcriptLanguage: transcript[0]?.lang,
    rawTranscript: transcript.map((entry) => entry.text.replace(/\s+/g, " ").trim()).join(" "),
    provider: "youtube-transcript"
  };
}

async function fetchTranscriptFromPlayzoneLib(videoId: string) {
  const { YouTubeTranscriptApi: PlayzoneTranscriptApi } = await import("@playzone/youtube-transcript/dist/api/index.js");
  const api = new PlayzoneTranscriptApi();
  const transcript = await api.fetch(videoId);

  if (!transcript?.snippets?.length) {
    throw new Error("The Playzone transcript library returned no transcript lines.");
  }

  return {
    videoId: transcript.videoId || videoId,
    transcriptLanguage: transcript.languageCode || transcript.language,
    rawTranscript: transcript.snippets.map((entry) => entry.text.replace(/\s+/g, " ").trim()).join(" "),
    provider: "playzone-youtube-transcript"
  };
}

function getCachedTranscript(videoId: string) {
  const entry = transcriptCache.get(videoId);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    transcriptCache.delete(videoId);
    return null;
  }

  return entry;
}

function cacheTranscriptSuccess(videoId: string, value: TranscriptPayload) {
  transcriptCache.set(videoId, {
    ok: true,
    expiresAt: Date.now() + SUCCESS_CACHE_TTL_MS,
    value
  });
}

function cacheTranscriptFailure(videoId: string, error: string) {
  transcriptCache.set(videoId, {
    ok: false,
    expiresAt: Date.now() + FAILURE_CACHE_TTL_MS,
    error
  });
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
  const cached = getCachedTranscript(videoId);
  if (cached?.ok) {
    return cached.value;
  }
  if (cached && !cached.ok) {
    throw new Error(cached.error);
  }

  const providerErrors: string[] = [];

  const providers: TranscriptProvider[] = [
    {
      id: "community-transcript-api",
      fetch: ({ videoUrl: nextVideoUrl }) => fetchTranscriptFromCommunityApi(nextVideoUrl)
    },
    {
      id: "tubetext",
      fetch: ({ videoId: nextVideoId }) => fetchTranscriptFromTubeText(nextVideoId)
    }
  ];

  if (env.transcriptBridgeUrl) {
    providers.push({
      id: "external-bridge",
      fetch: ({ videoUrl: nextVideoUrl }) => fetchTranscriptFromExternalBridge(nextVideoUrl)
    });
  }

  providers.push(
    {
      id: "playzone-youtube-transcript",
      fetch: ({ videoId: nextVideoId }) => fetchTranscriptFromPlayzoneLib(nextVideoId)
    },
    {
      id: "youtube-transcript",
      fetch: ({ videoId: nextVideoId }) => fetchTranscriptFromYoutubeTranscriptLib(nextVideoId)
    },
    {
      id: "youtube-caption-tracks",
      fetch: async ({ videoId: nextVideoId }) => {
        const fallback = await fetchTranscriptFromCaptionTracks(nextVideoId);
        if (!fallback.rawTranscript.trim()) {
          throw new Error("No transcript was found for this video.");
        }

        return fallback;
      }
    }
  );

  for (const provider of providers) {
    try {
      const transcript = await provider.fetch({ videoId, videoUrl });
      if (!transcript.rawTranscript.trim()) {
        throw new Error(`${provider.id} returned an empty transcript.`);
      }

      const normalized = {
        ...transcript,
        provider: transcript.provider ?? provider.id
      };
      cacheTranscriptSuccess(videoId, normalized);
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : `${provider.id} failed.`;
      if (message.includes("System busy, please try again in 15 minutes")) {
        cacheTranscriptFailure(videoId, message);
        throw error;
      }
      providerErrors.push(`${provider.id}: ${message}`);
    }
  }

  const message = `No transcript could be retrieved for this video. ${providerErrors.join(" | ")}`;
  cacheTranscriptFailure(videoId, message);
  throw new Error(message);
}
