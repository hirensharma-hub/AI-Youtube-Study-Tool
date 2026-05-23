"use client";

import { FormEvent, useMemo, useState } from "react";

// Client-side transcript utilities
import { extractVideoId } from "@/utils/extractVideoId";
import { fetchTranscriptClient } from "@/utils/fetchTranscriptClient";

type TranscriptSegment = {
  text: string;
  start: number;
  dur: number;
};

type TranscriptResponse = {
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
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(
      seconds
    ).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildTimestampedTranscript(segments: TranscriptSegment[]) {
  return segments
    .map((segment) => `[${formatTimestamp(segment.start)}] ${segment.text}`)
    .join("\n");
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

export function YoutubeTranscripter() {
  const [videoUrl, setVideoUrl] = useState("");
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const [withTimestamps, setWithTimestamps] = useState(true);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const outputText = useMemo(() => {
    if (!transcript) return "";

    return withTimestamps && transcript.segments.length
      ? buildTimestampedTranscript(transcript.segments)
      : transcript.text;
  }, [transcript, withTimestamps]);

  // ⭐ Client-side transcript fetcher
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedUrl = videoUrl.trim();
    if (!trimmedUrl || loading) return;

    setLoading(true);
    setCopied(false);
    setError("");
    setTranscript(null);

    try {
      const videoId = extractVideoId(trimmedUrl);
      if (!videoId) {
        setError("Invalid YouTube URL");
        setLoading(false);
        return;
      }

      // ⭐ FIXED: Pass full URL, not videoId
      const data = await fetchTranscriptClient(trimmedUrl);

      if (!data) {
        setError("No transcript available for this video.");
        setLoading(false);
        return;
      }

      setTranscript(data);
    } catch (err) {
      setError("Unable to fetch transcript.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!outputText) return;

    await navigator.clipboard.writeText(outputText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function handleDownload() {
    if (!transcript || !outputText) return;

    downloadText(`youtube-transcript-${transcript.videoId}.txt`, outputText);
  }

  return (
    <main className="transcripter-page">
      <div className="transcripter-orb transcripter-orb-one" />
      <div className="transcripter-orb transcripter-orb-two" />

      <section className="transcripter-shell">
        <div className="transcripter-hero">
          <p className="marketing-kicker">Free YouTube audio transcriber</p>
          <h1>Paste a video. Transcribe the audio. Keep moving.</h1>
          <p className="muted transcripter-lead">
            This page fetches transcripts directly from YouTube using your own IP address.
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

              <button
                className="button button-secondary"
                type="button"
                onClick={handleCopy}
                disabled={!outputText}
              >
                {copied ? "Copied" : "Copy"}
              </button>

              <button
                className="button button-secondary"
                type="button"
                onClick={handleDownload}
                disabled={!outputText}
              >
                Download
              </button>
            </div>
          </div>

          {transcript ? (
            <div className="transcripter-meta-row">
              <span>Video ID: {transcript.videoId}</span>
              <span>Language: {transcript.language}</span>
              <span>Provider: {transcript.provider}</span>
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
            <strong>No YouTube captions required</strong>
            <p className="muted">
              This tool fetches transcripts directly from YouTube’s timedtext API.
            </p>
          </article>

          <article className="panel">
            <strong>Realistic limits</strong>
            <p className="muted">Some videos may not have captions available.</p>
          </article>

          <article className="panel">
            <strong>Export friendly</strong>
            <p className="muted">Copy clean text or download a plain `.txt` file.</p>
          </article>
        </section>
      </section>
    </main>
  );
}
