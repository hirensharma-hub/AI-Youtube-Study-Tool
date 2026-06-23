import os
import sys
import logging
import traceback
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

# ==========================================
# 1. HIGH-VISIBILITY DEEBUGGER LOGGING SETUP
# ==========================================
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(filename)s:%(lineno)d - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout)  # Forces logs to stream live to HF Space Logs console
    ]
)
logger = logging.getLogger("hf_space_debugger")
logger.info("Initializing Hugging Face Space App with Debugger Wrapper...")

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
    
    # Safely inspect body without blocking runtime execution flow
    try:
        body = await request.body()
        if body:
            decoded_body = body.decode('utf-8', errors='ignore')
            logger.debug(f"[HF PAYLOAD STREAM] Raw Payload Snapshot (1000 chars): {decoded_body[:1000]}")
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
# 4. REQUEST SCHEMAS & DATA STRUCTURES
# ==========================================
class ChatMessage(BaseModel):
    role: str
    content: str

class CompletionRequest(BaseModel):
    messages: List[ChatMessage]
    model: Optional[str] = None
    temperature: Optional[float] = 0.1
    max_tokens: Optional[int] = 1000

# ==========================================
# 5. CORE ROUTE WIRED WITH DEEP VALIDATION
# ==========================================
@app.get("/")
async def root_status_check():
    logger.debug("[HF HEALTH] Root check hit.")
    return {"status": "online", "environment": "Hugging Face Space Debug Mode Active"}

@app.post("/")
async def handle_chat_completion(payload: CompletionRequest):
    logger.info(f"[AI PIPELINE] Payload received. Messages Count: {len(payload.messages)} | Model requested: {payload.model}")
    
    # Trace the last human prompt sent over from Next.js
    user_prompts = [msg.content for msg in payload.messages if msg.role == "user"]
    last_prompt = user_prompts[-1] if user_prompts else "No user prompt found"
    logger.debug(f"[AI PIPELINE] Target Prompt Segment length: {len(last_prompt)} characters.")
    logger.debug(f"[AI PIPELINE] Target Prompt Preview: {last_prompt[:300]}...")

    try:
        # ==========================================================
        # PLACEHOLDER FOR YOUR MODEL INFERENCE OR WRAPPER LOGIC
        # This replaces or triggers your original inference generation
        # ==========================================================
        generated_output = "" 
        
        # NOTE: If you use an explicit model/pipeline variable, invoke it safely below:
        # Example: generated_output = pipeline_runner(last_prompt)
        
        # Core validation guard against empty responses
        logger.debug(f"[AI INFERENCE RESULT] Raw model response object: '{generated_output}'")
        
        if not generated_output or str(generated_output).strip() == "":
            logger.error("[DEBUG CRITICAL FAILURE] The model inference returned a completely BLANK string layout!")
            
            # Temporary fallback structure so the Next.js pipeline doesn't crash completely
            fallback_text = f"### [HF Debug Fallback Alert]\nThe model failed to generate text content for this block. Raw Prompt Context length: {len(last_prompt)} characters."
            return JSONResponse(
                status_code=200, 
                content={"choices": [{"message": {"role": "assistant", "content": fallback_text}}]}
            )

        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": generated_output.strip()
                    }
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
    # Automatically running local port layout for the uvicorn process bridge
    uvicorn.run("app:app", host="0.0.0.0", port=8000, log_level="debug")
