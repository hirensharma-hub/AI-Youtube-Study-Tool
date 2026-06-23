import os
import sys
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
logger.info("Initializing Hugging Face Space App with Operational Transcript Engine...")

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
# 4. REQUEST SCHEMA (ALIGNED TO NEXT.JS BODY)
# ==========================================
class TranscriptRequest(BaseModel):
    videoUrl: str

# ==========================================
# 5. CORE ROUTE WIRED WITH TRANSCIPTER ENGINE
# ==========================================
@app.get("/")
async def root_status_check():
    return {"status": "online", "environment": "Production Audio Engine Active"}

@app.post("/")
async def handle_transcript_generation(payload: TranscriptRequest):
    logger.info(f"[AI PIPELINE] Processing transcription for URL: {payload.videoUrl}")
    
    try:
        # -------------------------------------------------------------
        # PLACE YOUR TRANSCIPTER LOGIC HERE
        # (Example below runs an API call or localized pipeline step)
        # -------------------------------------------------------------
        generated_transcript = ""
        
        # If your layout calls a secondary microservice or system script:
        # e.g., from YoutubeTranscripter import get_transcript
        # generated_transcript = get_transcript(payload.videoUrl)
        
        # --- REMOVE PLACEHOLDER TEST ONCE INTEGRATED ---
        if not generated_transcript:
            logger.warning("[AI ENGINE] No raw engine output. Testing fallback text injector.")
            generated_transcript = "This is a placeholder transcript. Please connect your specific transcription model or python-youtube-transcript library inside app.py to parse audio streams into full text."

        logger.debug(f"[AI INFERENCE RESULT] String preview: '{generated_transcript[:200]}...'")
        
        if not generated_transcript or str(generated_transcript).strip() == "":
            logger.error("[DEBUG CRITICAL FAILURE] The model inference returned a completely BLANK transcript string layout!")
            fallback_text = f"### [HF Debug Fallback Alert]\nThe model failed to generate text content for video url context: {payload.videoUrl}."
            return {
                "transcript": fallback_text,
                "subtitles": [{"text": fallback_text}]
            }

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
        raise pipeline_err

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, log_level="debug")
