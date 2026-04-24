import http from "node:http";
import { YoutubeTranscript } from "youtube-transcript";

const HOST = process.env.TRANSCRIPT_BRIDGE_HOST || "127.0.0.1";
const PORT = Number(process.env.TRANSCRIPT_BRIDGE_PORT || 4318);
const TOKEN = process.env.TRANSCRIPT_BRIDGE_TOKEN || "";

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
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

async function fetchTranscript(videoUrl) {
  const videoId = extractYouTubeVideoId(videoUrl);
  const transcript = await Promise.race([
    YoutubeTranscript.fetchTranscript(videoId),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Transcript bridge timed out while fetching captions.")), 30000);
    })
  ]);

  if (!Array.isArray(transcript) || transcript.length === 0) {
    throw new Error("No transcript was found for this video.");
  }

  return {
    videoId,
    transcriptLanguage: transcript[0]?.lang,
    rawTranscript: transcript.map((entry) => String(entry.text || "").replace(/\s+/g, " ").trim()).join(" ")
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
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    });
    response.end();
    return;
  }

  const url = new URL(request.url, `http://${HOST}:${PORT}`);

  if (request.method === "GET" && url.pathname === "/health") {
    writeJson(response, 200, { ok: true, source: "local-transcript-bridge" });
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
        error: error instanceof Error ? error.message : "Unable to retrieve a transcript locally."
      });
      return;
    }
  }

  writeJson(response, 404, { error: "Not found." });
});

server.listen(PORT, HOST, () => {
  console.log(`Transcript bridge listening on http://${HOST}:${PORT}`);
});
