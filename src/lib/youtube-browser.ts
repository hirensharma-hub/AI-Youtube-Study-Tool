"use client";

import { extractYouTubeVideoId } from "@/lib/youtube";

type BrowserTranscriptPayload = {
  videoId: string;
  rawTranscript: string;
  transcriptLanguage?: string;
};

export async function fetchVideoTranscriptInBrowser(videoUrl: string): Promise<BrowserTranscriptPayload> {
  const videoId = extractYouTubeVideoId(videoUrl);
  if (!videoId) throw new Error("Invalid Video ID");

  // We use a CORS proxy to prevent the browser from blocking the request
  const proxy = "https://corsproxy.io/?"; 
  const apiUrl = `https://pipedapi.kavin.rocks/streams/${videoId}`;

  try {
    const response = await fetch(proxy + encodeURIComponent(apiUrl));
    if (!response.ok) throw new Error("Proxy fetch failed");

    const data = await response.json();
    const subtitles = data.subtitles || [];
    
    // Find English or the first available
    const targetSub = subtitles.find((s: any) => s.code === 'en') || subtitles[0];
    if (!targetSub) throw new Error("No subtitles found");

    // Fetch the actual text via proxy
    const vttRes = await fetch(proxy + encodeURIComponent(targetSub.url));
    const vttText = await vttRes.text();

    // Clean the VTT format to plain text
    const cleanText = vttText
      .split('\n')
      .filter(line => !line.includes('-->') && line.trim() && !line.startsWith('WEBVTT'))
      .map(line => line.replace(/<[^>]+>/g, '').trim())
      .join(' ');

    return {
      videoId,
      rawTranscript: cleanText,
      transcriptLanguage: targetSub.code
    };
  } catch (error) {
    console.error("Browser extraction failed:", error);
    // This throw is important: it tells the app to try the server fallback
    throw error; 
  }
}
