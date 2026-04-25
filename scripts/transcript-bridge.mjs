import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

const HOST = process.env.TRANSCRIPT_BRIDGE_HOST || "127.0.0.1";
const PORT = Number(process.env.TRANSCRIPT_BRIDGE_PORT || 4318);
const TOKEN = process.env.TRANSCRIPT_BRIDGE_TOKEN || "";
const DEFAULT_USER_AGENT =
  process.env.TRANSCRIPT_BRIDGE_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const DEFAULT_REFERER = process.env.TRANSCRIPT_BRIDGE_REFERER || "https://www.youtube.com/";
const DEFAULT_COOKIE_FILE = process.env.TRANSCRIPT_BRIDGE_COOKIE_FILE || path.join(process.cwd(), "cookies.json");

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractYouTubeVideoId(input) {
  const trimmed = String(input || "").trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  let url;

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

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("The transcript bridge received invalid JSON.");
  }
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function parseNetscapeCookieFile(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#") || line.startsWith("#HttpOnly_"))
    .map((line) => line.replace(/^#HttpOnly_/, ""))
    .map((line) => line.split("\t"))
    .filter((parts) => parts.length >= 7)
    .map((parts) => {
      const name = parts[5];
      const value = parts[6];
      return name && value ? `${name}=${value}` : "";
    })
    .filter(Boolean)
    .join("; ");
}

function parseCookieJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");

  if (/^\s*#\s*Netscape\s+HTTP\s+Cookie\s+File/i.test(raw) || /^\s*#HttpOnly_/m.test(raw)) {
    return parseNetscapeCookieFile(raw);
  }

  const parsed = JSON.parse(raw);

  if (typeof parsed === "string") {
    return parsed.trim();
  }

  if (Array.isArray(parsed)) {
    return parsed
      .filter((entry) => entry && typeof entry.name === "string" && typeof entry.value === "string")
      .map((entry) => `${entry.name}=${entry.value}`)
      .join("; ");
  }

  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }

  return "";
}

function loadCookieHeader() {
  const fromEnv = process.env.TRANSCRIPT_BRIDGE_COOKIE || "";
  if (fromEnv.trim()) {
    return fromEnv.trim();
  }

  if (!fs.existsSync(DEFAULT_COOKIE_FILE)) {
    return "";
  }

  try {
    return parseCookieJsonFile(DEFAULT_COOKIE_FILE).trim();
  } catch {
    throw new Error(
      `Cookie file could not be parsed at ${DEFAULT_COOKIE_FILE}. ` +
        `Use TRANSCRIPT_BRIDGE_COOKIE or provide a valid cookies.json file.`
    );
  }
}

function buildBrowserHeaders() {
  const cookie = loadCookieHeader();
  if (!cookie) {
    throw new Error(
      "No browser cookie is configured for the transcript bridge. " +
        "Set TRANSCRIPT_BRIDGE_COOKIE or provide cookies.json beside the bridge."
    );
  }

  return {
    "User-Agent": DEFAULT_USER_AGENT,
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: cookie,
    Referer: DEFAULT_REFERER
  };
}

function extractBalancedJson(source, anchorPattern) {
  const anchorRegex = new RegExp(anchorPattern.source, anchorPattern.flags);
  const anchorMatch = anchorRegex.exec(source);
  if (!anchorMatch || anchorMatch.index < 0) {
    throw new Error("Data structure missing. IP likely flagged or extractor needs update.");
  }

  const start = source.indexOf("{", anchorMatch.index);
  if (start < 0) {
    throw new Error("Player response JSON start could not be found.");
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error("Player response JSON block was not balanced.");
}

function parsePlayerResponse(html) {
  const jsonText = extractBalancedJson(html, /(?:var\s+)?ytInitialPlayerResponse\s*=\s*/);

  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error("ytInitialPlayerResponse was found but could not be parsed.");
  }
}

function parseTranscript(vttText) {
  const normalized = String(vttText || "").replace(/\r/g, "");
  const lines = normalized.split("\n");
  const textParts = [];
  let skipBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      skipBlock = false;
      continue;
    }

    if (/^WEBVTT\b/i.test(line) || /^Kind:/i.test(line) || /^Language:/i.test(line)) {
      continue;
    }

    if (/^(NOTE|STYLE|REGION)\b/i.test(line)) {
      skipBlock = true;
      continue;
    }

    if (skipBlock) {
      continue;
    }

    if (/^\d+$/.test(line)) {
      continue;
    }

    if (
      /^\d{1,2}:\d{2}(?::\d{2})?[\.,]\d{3}\s+-->\s+\d{1,2}:\d{2}(?::\d{2})?[\.,]\d{3}/.test(line)
    ) {
      continue;
    }

    const cleaned = line
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned) {
      textParts.push(cleaned);
    }
  }

  return textParts.join(" ").replace(/\s+/g, " ").trim();
}

function parseJson3Transcript(json3) {
  if (!json3 || !Array.isArray(json3.events)) {
    return "";
  }

  const textParts = [];
  for (const event of json3.events) {
    if (!Array.isArray(event?.segs)) {
      continue;
    }

    for (const segment of event.segs) {
      const text = String(segment?.utf8 || "").replace(/\s+/g, " ").trim();
      if (text) {
        textParts.push(text);
      }
    }
  }

  return textParts.join(" ").replace(/\s+/g, " ").trim();
}

function parseXmlTranscript(xmlText) {
  const normalized = String(xmlText || "").replace(/\r/g, "");
  const textParts = [];

  const textNodeRegex = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
  for (const match of normalized.matchAll(textNodeRegex)) {
    const content = decodeHtmlEntities(match[1] || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (content) {
      textParts.push(content);
    }
  }

  if (textParts.length) {
    return textParts.join(" ").replace(/\s+/g, " ").trim();
  }

  const pNodeRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  for (const match of normalized.matchAll(pNodeRegex)) {
    const content = decodeHtmlEntities(match[1] || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (content) {
      textParts.push(content);
    }
  }

  return textParts.join(" ").replace(/\s+/g, " ").trim();
}

async function fetchTranscriptWithLibrary(videoId, browserHeaders, preferredLanguage = "en") {
  const { fetchTranscript: fetchTranscriptViaLib } = await import(
    "youtube-transcript/dist/youtube-transcript.esm.js"
  );

  const wrappedFetch = (input, init = {}) =>
    fetch(input, {
      ...init,
      headers: {
        ...browserHeaders,
        ...(init.headers || {})
      }
    });

  const entries = await fetchTranscriptViaLib(videoId, {
    lang: preferredLanguage,
    fetch: wrappedFetch
  });

  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  const rawTranscript = entries
    .map((entry) => String(entry?.text || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!rawTranscript) {
    return null;
  }

  return {
    rawTranscript,
    transcriptLanguage: entries[0]?.lang || preferredLanguage
  };
}

async function fetchTranscript(videoUrl) {
  const videoId = extractYouTubeVideoId(videoUrl);
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const browserHeaders = buildBrowserHeaders();

  const response = await fetch(watchUrl, {
    headers: browserHeaders
  });

  const html = await response.text();
  if (!response.ok) {
    throw new Error(`Watch page returned HTTP ${response.status}.`);
  }

  if (html.includes("Our systems have detected unusual traffic") || html.includes("/sorry/")) {
    throw new Error("Google Sorry wall detected. Refresh the browser cookie used by the transcript bridge.");
  }

  const playerResponse = parsePlayerResponse(html);
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!Array.isArray(tracks) || tracks.length === 0) {
    try {
      const fallback = await fetchTranscriptWithLibrary(videoId, browserHeaders, "en");
      if (fallback) {
        return {
          videoId,
          transcriptLanguage: fallback.transcriptLanguage,
          rawTranscript: fallback.rawTranscript
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      throw new Error(`Captions object not found in player response. libraryFallbackError=${message}`);
    }

    throw new Error("Captions object not found in player response.");
  }

  const track = tracks.find((entry) => entry?.vssId?.includes("en")) || tracks[0];
  if (!track?.baseUrl) {
    throw new Error("Caption track metadata was found, but the baseUrl was missing.");
  }

  const debug = {
    trackVssId: track.vssId || null,
    trackLanguageCode: track.languageCode || null
  };

  const captionResponse = await fetch(`${track.baseUrl}&fmt=vtt`, {
    headers: browserHeaders
  });
  debug.vttStatus = captionResponse.status;
  debug.vttContentType = captionResponse.headers.get("content-type") || null;

  if (!captionResponse.ok) {
    throw new Error(`Caption file request failed with HTTP ${captionResponse.status}.`);
  }

  const vttText = decodeHtmlEntities(await captionResponse.text());
  debug.vttLength = vttText.length;
  debug.vttPreview = vttText.slice(0, 180).replace(/\s+/g, " ");
  let rawTranscript = parseTranscript(vttText);
  debug.vttParsedLength = rawTranscript.length;

  if (!rawTranscript) {
    const json3Response = await fetch(`${track.baseUrl}&fmt=json3`, {
      headers: browserHeaders
    });
    debug.json3Status = json3Response.status;
    debug.json3ContentType = json3Response.headers.get("content-type") || null;

    if (json3Response.ok) {
      const json3Text = await json3Response.text();
      debug.json3Length = json3Text.length;
      debug.json3Preview = json3Text.slice(0, 180).replace(/\s+/g, " ");
      if (json3Text.trim()) {
        try {
          const json3 = JSON.parse(json3Text);
          rawTranscript = parseJson3Transcript(json3);
          debug.json3ParsedLength = rawTranscript.length;
        } catch {
          // Some caption endpoints return empty or malformed JSON despite 200.
          // Keep rawTranscript empty and let the final error explain parsing failed.
          debug.json3ParseError = "invalid-json";
        }
      }
    }
  }

  if (!rawTranscript) {
    const rawCaptionResponse = await fetch(track.baseUrl, {
      headers: browserHeaders
    });
    debug.rawStatus = rawCaptionResponse.status;
    debug.rawContentType = rawCaptionResponse.headers.get("content-type") || null;

    if (rawCaptionResponse.ok) {
      const rawCaptionText = decodeHtmlEntities(await rawCaptionResponse.text());
      debug.rawLength = rawCaptionText.length;
      debug.rawPreview = rawCaptionText.slice(0, 180).replace(/\s+/g, " ");
      rawTranscript = parseXmlTranscript(rawCaptionText);
      debug.rawParsedLength = rawTranscript.length;
    }
  }

  if (!rawTranscript) {
    try {
      const fallback = await fetchTranscriptWithLibrary(videoId, browserHeaders, track.languageCode || "en");
      if (fallback) {
        rawTranscript = fallback.rawTranscript;
        debug.libraryParsedLength = rawTranscript.length;
        debug.libraryFallbackLanguage = fallback.transcriptLanguage;
      }
    } catch (error) {
      debug.libraryFallbackError = error instanceof Error ? error.message : "unknown";
    }
  }

  if (!rawTranscript) {
    throw new Error(
      `VTT captions were fetched, but no transcript text could be parsed. debug=${JSON.stringify(debug)}`
    );
  }

  return {
    videoId,
    transcriptLanguage: track.languageCode || "en",
    rawTranscript
  };
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    writeJson(response, 400, { error: "Missing request URL." });
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    });
    response.end();
    return;
  }

  const url = new URL(request.url, `http://${HOST}:${PORT}`);

  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(response, 200, {
      ok: true,
      source: "stealth-transcript-bridge",
      cookieSource: process.env.TRANSCRIPT_BRIDGE_COOKIE ? "env" : fs.existsSync(DEFAULT_COOKIE_FILE) ? "file" : "missing"
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/transcript") {
    try {
      if (TOKEN) {
        const header = request.headers.authorization || "";
        if (header !== `Bearer ${TOKEN}`) {
          writeJson(response, 401, { error: "Unauthorized transcript bridge request." });
          return;
        }
      }

      const body = await readJsonBody(request);
      const videoUrl = String(body.videoUrl || "").trim();

      if (!videoUrl) {
        writeJson(response, 400, { error: "A videoUrl is required." });
        return;
      }

      const transcript = await fetchTranscript(videoUrl);
      writeJson(response, 200, transcript);
      return;
    } catch (error) {
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : "Unable to retrieve a transcript with the stealth bridge."
      });
      return;
    }
  }

  writeJson(response, 404, { error: "Not found." });
});

server.listen(PORT, HOST, () => {
  console.log(`Transcript bridge listening on http://${HOST}:${PORT}`);
});
