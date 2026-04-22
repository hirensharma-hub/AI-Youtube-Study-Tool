"use client";

import { extractYouTubeVideoId } from "@/lib/youtube";

type BrowserCaptionTrack = {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
};

type BrowserTranscriptPayload = {
  videoId: string;
  rawTranscript: string;
  transcriptLanguage?: string;
};

type PlayerClient = {
  clientName: string;
  clientVersion: string;
  thirdParty?: {
    embedUrl: string;
  };
};

const PLAYER_CLIENTS: PlayerClient[] = [
  {
    clientName: "WEB",
    clientVersion: "2.20250418.01.00"
  },
  {
    clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    clientVersion: "2.0",
    thirdParty: {
      embedUrl: "https://www.youtube.com"
    }
  }
];

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function parsePlayerResponseFromHtml(html: string) {
  const patterns = [
    /ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/,
    /["']PLAYER_RESPONSE["']\s*:\s*"((?:\\.|[^"])*)"/
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) {
      continue;
    }

    try {
      if (pattern === patterns[0]) {
        return JSON.parse(match[1]);
      }

      return JSON.parse(JSON.parse(`"${match[1]}"`));
    } catch {
      continue;
    }
  }

  return null;
}

function getCaptionTracks(payload: any): BrowserCaptionTrack[] {
  const tracks = payload?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) ? tracks : [];
}

function chooseCaptionTrack(tracks: BrowserCaptionTrack[]) {
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

function parseCaptionXml(xml: string) {
  const parser = new DOMParser();
  const document = parser.parseFromString(xml, "application/xml");
  const textNodes = Array.from(document.getElementsByTagName("text"));

  const textEntries = textNodes
    .map((node) => decodeXmlEntities(node.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (textEntries.length) {
    return textEntries;
  }

  const paragraphNodes = Array.from(document.getElementsByTagName("p"));
  return paragraphNodes
    .map((node) => decodeXmlEntities(node.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

async function fetchPlayerPayload(videoId: string) {
  for (const client of PLAYER_CLIENTS) {
    try {
      const response = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
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
        continue;
      }

      const payload = await response.json();
      if (getCaptionTracks(payload).length) {
        return payload;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function fetchWatchPagePayload(videoId: string) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en&bpctr=9999999999&has_verified=1`);
  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  return parsePlayerResponseFromHtml(html);
}

async function fetchCaptionTrackTranscript(track: BrowserCaptionTrack) {
  const captionUrl = new URL(track.baseUrl);
  if (!captionUrl.searchParams.has("fmt")) {
    captionUrl.searchParams.set("fmt", "srv3");
  }

  const response = await fetch(captionUrl.toString());
  if (!response.ok) {
    throw new Error(`Caption track returned HTTP ${response.status}.`);
  }

  const xml = await response.text();
  return parseCaptionXml(xml);
}

export async function fetchVideoTranscriptInBrowser(videoUrl: string): Promise<BrowserTranscriptPayload> {
  const videoId = extractYouTubeVideoId(videoUrl);
  const payload = (await fetchPlayerPayload(videoId)) ?? (await fetchWatchPagePayload(videoId));

  if (!payload) {
    throw new Error("The browser could not access YouTube caption data for this video.");
  }

  const track = chooseCaptionTrack(getCaptionTracks(payload));
  if (!track) {
    throw new Error("No caption track was available in the browser for this video.");
  }

  const lines = await fetchCaptionTrackTranscript(track);
  if (!lines.length) {
    throw new Error("The browser found captions but could not read transcript lines.");
  }

  return {
    videoId,
    transcriptLanguage: track.languageCode,
    rawTranscript: lines.join(" ")
  };
}
