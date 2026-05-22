import http from "node:http";
import { URL } from "node:url";

const HOST = process.env.TRANSCRIPT_BRIDGE_HOST || "127.0.0.1";
const PORT = Number(process.env.TRANSCRIPT_BRIDGE_PORT || 4318);
const TOKEN = process.env.TRANSCRIPT_BRIDGE_TOKEN || "";
const MCP_TRANSCRIPT_URL =
  process.env.MCP_TRANSCRIPT_URL || "http://localhost:19720/api/transcripts";

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
    throw new Error("Could not extract a YouTube video ID from that URL.");
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

async function fetchTranscriptFromLocalMcp(videoUrl) {
  let response;

  try {
    response = await fetch(MCP_TRANSCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url: videoUrl, videoUrl })
    });
  } catch {
    const error = new Error("Transcription Engine Offline");
    error.statusCode = 503;
    throw error;
  }

  if (!response.ok) {
    const error = new Error("Transcription Engine Offline");
    error.statusCode = 503;
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error("Transcription Engine Offline");
    error.statusCode = 503;
    throw error;
  }

  const transcript =
    typeof payload?.transcript === "string"
      ? payload.transcript.trim()
      : typeof payload?.rawTranscript === "string"
        ? payload.rawTranscript.trim()
        : typeof payload?.text === "string"
          ? payload.text.trim()
          : "";

  if (!transcript) {
    const error = new Error("Transcription Engine Offline");
    error.statusCode = 503;
    throw error;
  }

  return transcript;
}

function buildMcpHealthUrl() {
  try {
    const endpoint = new URL(MCP_TRANSCRIPT_URL);
    endpoint.pathname = "/health";
    endpoint.search = "";
    return endpoint.toString();
  } catch {
    return "http://localhost:19720/health";
  }
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
    try {
      const healthResponse = await fetch(buildMcpHealthUrl());

      writeJson(response, 200, {
        ok: true,
        source: "local-mcp-transcription-bridge",
        mcpUrl: MCP_TRANSCRIPT_URL,
        mcpReachable: healthResponse.ok
      });
      return;
    } catch {
      writeJson(response, 200, {
        ok: true,
        source: "local-mcp-transcription-bridge",
        mcpUrl: MCP_TRANSCRIPT_URL,
        mcpReachable: false
      });
      return;
    }
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
      const videoUrl = String(body.videoUrl || body.url || "").trim();

      if (!videoUrl) {
        writeJson(response, 400, { error: "A videoUrl is required." });
        return;
      }

      const videoId = extractYouTubeVideoId(videoUrl);
      const transcript = await fetchTranscriptFromLocalMcp(videoUrl);

      writeJson(response, 200, {
        transcript,
        rawTranscript: transcript,
        videoId
      });
      return;
    } catch (error) {
      const statusCode = Number(error?.statusCode || 500);
      if (statusCode === 503) {
        writeJson(response, 503, { error: "Transcription Engine Offline" });
        return;
      }

      writeJson(response, 500, {
        error:
          error instanceof Error
            ? error.message
            : "Unable to retrieve a transcript from the local MCP service."
      });
      return;
    }
  }

  writeJson(response, 404, { error: "Not found." });
});

server.listen(PORT, HOST, () => {
  console.log(`Transcript bridge listening on http://${HOST}:${PORT}`);
});
