"use client";

import { extractYouTubeVideoId } from "@/lib/youtube";

type BrowserTranscriptPayload = {
  videoId: string;
  rawTranscript: string;
  transcriptLanguage?: string;
};

export async function fetchVideoTranscriptInBrowser(videoUrl: string): Promise<BrowserTranscriptPayload> {
  const videoId = extractYouTubeVideoId(videoUrl);
  if (!videoId) {
    throw new Error("Could not find a valid YouTube Video ID");
  }

  try {
    // 1. Ask a public, open-source proxy for the video data
    // This bypasses YouTube's IP blocks AND browser CORS rules!
    const response = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`);
    
    if (!response.ok) {
      throw new Error("Proxy could not fetch video data.");
    }

    const data = await response.json();
    const subtitles = data.subtitles || [];
    
    // 2. Find English captions (or fallback to whatever is first)
    const englishSub = subtitles.find((s: any) => s.code === 'en' || s.name.toLowerCase().includes('english'));
    const targetSub = englishSub || subtitles[0];

    if (!targetSub || !targetSub.url) {
      throw new Error("No transcript available for this video.");
    }

    // 3. Download the actual subtitle file (VTT format)
    const vttResponse = await fetch(targetSub.url);
    if (!vttResponse.ok) {
      throw new Error("Failed to download transcript text.");
    }

    const vttText = await vttResponse.text();

    // 4. Clean up the file (remove timestamps like 00:00:01.000 --> 00:00:05.000)
    const rawTranscript = vttText
      .split('\n')
      .filter(line => 
        line.trim() !== '' && 
        !line.includes('-->') && 
        !line.startsWith('WEBVTT') &&
        !line.startsWith('Kind:') &&
        !line.startsWith('Language:')
      )
      .map(line => line.replace(/<[^>]+>/g, '').trim()) // Remove HTML tags
      .join(' ')
      .replace(/\s+/g, ' ') // Remove extra spaces
      .trim();

    return {
      videoId: videoId,
      rawTranscript: rawTranscript,
      transcriptLanguage: targetSub.code || "en"
    };

  } catch (error: any) {
    console.error("Browser transcript error:", error);
    throw new Error("Failed to extract transcript from open-source proxy.");
  }
}
