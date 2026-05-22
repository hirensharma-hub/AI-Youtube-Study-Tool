"use client";

import { FormEvent, useMemo, useState } from "react";

type TranscriptSegment = {
  text: string;
  start: number;
  duration: number;
  lang?: string;
};

type TranscriptResponse = {
  videoUrl: string;
  videoId: string;
  language: string;
  provider: string;
  text: string;
  segments: TranscriptSegment[];
  segmentCount: number;
  characterCount: number;
};

function formatTimestamp(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildTimestampedTranscript(segments: TranscriptSegment[]) {
  return segments.map((segment) => `[${formatTimestamp(segment.start)}] ${segment.text}`).join("\n");
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Transcript request failed.";
    throw new Error(message);
  }

  return payload as T;
}

export function YoutubeTranscripter() {
  const [videoUrl, setVideoUrl] = useState("");
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [withTimestamps, setWithTimestamps] = useState(true);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const outputText = useMemo(() => {
    if (!transcript) {
      return "";
    }

    return withTimestamps ? buildTimestampedTranscript(transcript.segments) : transcript.text;
  }, [transcript, withTimestamps]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedUrl = videoUrl.trim();
    if (!trimmedUrl || loading) {
      return;
    }

    setLoading(true);
    setCopied(false);
    setError("");
    setTranscript(null);

    try {
      const response = await fetch("/api/youtube-transcript", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ videoUrl: trimmedUrl })
      });
      const data = await readJson<TranscriptResponse>(response);
      setTranscript(data);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to fetch that transcript right now."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!outputText) {
      return;
    }

    await navigator.clipboard.writeText(outputText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function handleDownload() {
    if (!transcript || !outputText) {
      return;
    }

    downloadText(`youtube-transcript-${transcript.videoId}.txt`, outputText);
  }

  return (
    <main className="transcripter-page">
      <div className="transcripter-orb transcripter-orb-one" />
      <div className="transcripter-orb transcripter-orb-two" />
      <section className="transcripter-shell">
        <div className="transcripter-hero">
          <p className="marketing-kicker">Free YouTube transcript extractor</p>
          <h1>Paste a video. Pull the transcript. Keep moving.</h1>
          <p className="muted transcripter-lead">
            This runs through our own server route and YouTube caption tracks, with no paid transcript API key.
            If a video has no available captions or YouTube blocks automated access, the app will tell you cleanly.
          </p>
        </div>

        <form className="panel transcripter-form" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="youtube-url">
            YouTube URL
          </label>
          <input
            id="youtube-url"
            className="transcripter-input"
            placeholder="https://www.youtube.com/watch?v=..."
            value={videoUrl}
            onChange={(event) => setVideoUrl(event.target.value)}
          />
          <button className="button button-primary transcripter-submit" disabled={loading}>
            {loading ? "Fetching transcript..." : "Get transcript"}
          </button>
        </form>

        {error ? (
          <section className="panel transcripter-error" role="alert">
            <strong>Transcript unavailable</strong>
            <p>{error}</p>
          </section>
        ) : null}

        <section className="panel transcripter-output-card">
          <div className="transcripter-output-header">
            <div>
              <p className="sidebar-eyebrow muted">Output</p>
              <h2>{transcript ? "Transcript ready" : "Your transcript will appear here"}</h2>
            </div>
            <div className="transcripter-actions">
              <label className="transcripter-toggle">
                <input
                  type="checkbox"
                  checked={withTimestamps}
                  onChange={(event) => setWithTimestamps(event.target.checked)}
                />
                Timestamps
              </label>
              <button className="button button-secondary" type="button" onClick={handleCopy} disabled={!outputText}>
                {copied ? "Copied" : "Copy"}
              </button>
              <button className="button button-secondary" type="button" onClick={handleDownload} disabled={!outputText}>
                Download
              </button>
            </div>
          </div>

          {transcript ? (
            <div className="transcripter-meta-row">
              <span>Video ID: {transcript.videoId}</span>
              <span>Language: {transcript.language}</span>
              <span>{transcript.segmentCount.toLocaleString()} segments</span>
              <span>{transcript.characterCount.toLocaleString()} chars</span>
            </div>
          ) : null}

          <textarea
            className="transcripter-output"
            readOnly
            value={outputText}
            placeholder="Paste a YouTube URL above to fetch caption text."
          />
        </section>

        <section className="transcripter-notes">
          <article className="panel">
            <strong>No account needed</strong>
            <p className="muted">This standalone page does not use MongoDB, Ollama, or paid transcript services.</p>
          </article>
          <article className="panel">
            <strong>Realistic limits</strong>
            <p className="muted">Free and unlimited on our side, but YouTube can rate-limit or hide captions for some videos.</p>
          </article>
          <article className="panel">
            <strong>Export friendly</strong>
            <p className="muted">Copy clean text, keep timestamps, or download a plain `.txt` file.</p>
          </article>
        </section>
      </section>
    </main>
  );
}
