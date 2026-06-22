import re
import traceback
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="YouTube Robust Federated Transcript API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TranscriptRequest(BaseModel):
    videoUrl: str

def extract_video_id(url: str) -> str:
    match = re.search(r"(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})", url)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL format.")
    return match.group(1)

@app.post("/")
async def get_transcript(payload: TranscriptRequest):
    video_id = extract_video_id(payload.videoUrl)
    
    # Route directly to the public transcript engine to bypass data center blocks
    target_url = f"https://youtube-transcript.ai/transcript/{video_id}.txt"
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(target_url)
            
            if response.status_code != 200:
                raise HTTPException(
                    status_code=response.status_code, 
                    detail="Failed to extract data from external transcript engine."
                )
                
            # Clean up formatting brackets returned by the engine
            raw_text = response.text
            clean_transcript = re.sub(r'\[\d+:\d+\]', '', raw_text) # strip [0:00] timestamps
            clean_transcript = " ".join(clean_transcript.split())   # normalize whitespaces
            
            # Formatted to perfectly match your frontend array layout expectations
            return {
                "success": True,
                "videoId": video_id,
                "transcript": clean_transcript.strip(),
                "subtitles": [
                    {
                        "text": clean_transcript.strip()
                    }
                ]
            }
            
    except Exception as e:
        print("\n--- DETECTED TRANSCRIPT EXCEPTION ---")
        traceback.print_exc()
        print("-------------------------------------\n")
        
        error_msg = str(e).split('\n')[0]
        raise HTTPException(status_code=500, detail=f"Transcript Router Error: {error_msg}")
