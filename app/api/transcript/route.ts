import { NextRequest, NextResponse } from "next/server";

function extractVideoId(url: string): string | null {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { videoUrl } = body;

    if (!videoUrl) {
      return NextResponse.json({ error: 'Missing videoUrl parameter' }, { status: 400 });
    }

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      return NextResponse.json({ error: 'Could not extract valid YouTube Video ID' }, { status: 400 });
    }

    console.log(`[Next.js App Router] Forwarding request to Python FastAPI proxy backend for video: ${videoId}`);

    // --- CONNECT NEXTJS FRONTEND TO FASTAPI BACKEND ---
    const pythonBackendUrl = "http://127.0.0.1:8000/";
    
    const response = await fetch(pythonBackendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ videoUrl: videoUrl }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: "Unknown backend error" }));
      throw new Error(errorData.detail || `FastAPI returned status ${response.status}`);
    }

    const data = await response.json();

    // Return the response structured exactly how your frontend application expects it
    return NextResponse.json({
      success: true,
      id: videoId,
      title: "YouTube Video Asset",
      transcript: data.transcript,
      subtitles: data.subtitles || [{ text: data.transcript }]
    });

  } catch (error: any) {
    console.error(`[Next.js App Router] Transcript Pipeline Error:`, error.message);
    return NextResponse.json({
      error: "Failed to compile transcript pipeline.",
      details: error.message
    }, { status: 500 });
  }
}
