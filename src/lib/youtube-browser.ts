"use client";

import { extractYouTubeVideoId } from "@/lib/youtube";

// These are the "names" your original code expects
type BrowserTranscriptPayload = {
  videoId: string;
  rawTranscript: string;
  transcriptLanguage?: string;
};

/**
 * NEW SIMPLIFIED VERSION: 
 * Uses the library in layout.tsx to grab transcripts reliably.
 */
export async function fetchVideoTranscriptInBrowser(videoUrl: string): Promise<BrowserTranscriptPayload> {
  const videoId = extractYouTubeVideoId(videoUrl);
  
  if (!videoId) {
    throw new Error("Could not find a valid YouTube Video ID");
  }

  try {
    // 1. Check if the 'Helper' library we added to the HTML is there
    const ytLib = (window as any).YoutubeTranscript;
    
    if (!ytLib) {
      throw new Error("Transcript library not found. Ensure the script tag is in layout.tsx");
    }

    // 2. Fetch the data from YouTube (using your home IP)
    const data = await ytLib.fetchTranscript(videoId);

    // 3. Convert it into the exact format your 'chat-workspace.tsx' needs
    return {
      videoId: videoId,
      transcriptLanguage: "en", // Defaulting to English
      rawTranscript: data.map((part: any) => part.text).join(' ')
    };

  } catch (error: any) {
    console.error("Browser transcript error:", error);
    throw new Error("YouTube blocked this device or captions are unavailable.");
  }
}
