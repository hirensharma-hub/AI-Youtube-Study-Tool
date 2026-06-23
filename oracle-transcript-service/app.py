import os
import sys
import re
import logging
import traceback
import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

# ==========================================
# 1. HIGH-VISIBILITY DEBUGGER LOGGING SETUP
# ==========================================
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(filename)s:%(lineno)d - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("hf_space_debugger")
logger.info("Initializing Hugging Face Space App with External youtube-transcript.ai Engine...")

app = FastAPI(title="Oracle Transcript AI Service Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 2. INCOMING REQUEST METRIC MIDDLEWARE
# ==========================================
@app.middleware("http")
async def log_incoming_requests(request: Request, call_next):
    logger.debug(f"[HF INBOUND] Request Method: {request.method} | Path: {request.url.path}")
    try:
        body = await request.body()
        if body:
            decoded_body = body.decode('utf-8', errors='ignore')
            logger.debug(f"[HF PAYLOAD STREAM] Raw Payload Snapshot: {decoded_body[:1000]}")
    except Exception as e:
        logger.warning(f"[HF WARN] Could not intercept request body stream: {e}")

    response = await call_next(request)
    logger.debug(f"[HF OUTBOUND] Finished path: {request.url.path} with Status Code: {response.status_code}")
    return response

# ==========================================
# 3. GLOBAL CRASH CAPTURE INTERCEPTOR
# ==========================================
@app.exception_handler(Exception)
async def global_exception_debugger(request: Request, exc: Exception):
    error_trace = traceback.format_exc()
    logger.error(f"!!! CRITICAL CRASH IN HUGGING FACE SPACE !!!\n{error_trace}")
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal pipeline crash inside Hugging Face Space.",
            "details": str(exc),
            "traceback": error_trace.split("\n")
        }
    )

# ==========================================
# 4. REQUEST HELPER & SCHEMAS
# ==========================================
class TranscriptRequest(BaseModel):
    videoUrl: str

def extract_video_id(url: str) -> Optional[str]:
    reg_exp = r"^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*"
    match = re.match(reg_exp, url)
    if match and len(match.group(2)) == 11:
        return match.group(2)
    return None

# ==========================================
# 5. CORE ROUTE WIRED WITH youtube-transcript.ai
# ==========================================
@app.get("/")
async def root_status_check():
    return {"status": "online", "environment": "youtube-transcript.ai Engine Proxy Active"}

@app.post("/")
async def handle_transcript_generation(payload: TranscriptRequest):
    logger.info(f"[AI PIPELINE] Processing transcription for URL: {payload.videoUrl}")
    
    video_id = extract_video_id(payload.videoUrl)
    if not video_id:
        logger.error(f"[AI ENGINE] Could not extract valid YouTube ID from URL: {payload.videoUrl}")
        raise HTTPException(status_code=400, detail="Invalid YouTube Video URL format.")

    try:
        # Request target targeting the external youtube-transcript.ai engine text endpoint
        target_api_url = f"https://youtube-transcript.ai/transcript/{video_id}.txt"
        logger.info(f"[AI ENGINE] Routing GET proxy request to: {target_api_url}")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            api_response = await client.get(target_api_url)
            
            if api_response.status_code != 200:
                logger.error(f"[AI ENGINE] External API returned error status: {api_response.status_code}")
                raise HTTPException(
                    status_code=api_response.status_code, 
                    detail="Failed fetching from external transcription API provider."
                )
                
            generated_transcript = api_response.text

        logger.debug(f"[AI INFERENCE RESULT] String preview: '{generated_transcript[:200]}...'")
        
        if not generated_transcript or str(generated_transcript).strip() == "":
            raise ValueError("External API provider returned an empty text body response.")

        return {
            "transcript": generated_transcript.strip(),
            "subtitles": [
                {
                    "text": generated_transcript.strip()
                }
            ]
        }

    except Exception as pipeline_err:
        err_stack = traceback.format_exc()
        logger.error(f"[AI PIPELINE EXCEPTION] Error occurred during generation stage: {pipeline_err}")
        logger.error(err_stack)
        
        fallback_text = f"### [HF Debug Fallback Alert]\nFailed to retrieve transcript for video ID {video_id} via external engine service layout."
        return {
            "transcript": fallback_text,
            "subtitles": [{"text": fallback_text}]
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, log_level="debug")
