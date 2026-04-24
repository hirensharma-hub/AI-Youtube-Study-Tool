import os
import re
import shutil
import tempfile
from functools import lru_cache
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, HttpUrl
from yt_dlp import YoutubeDL

try:
    from faster_whisper import WhisperModel
except Exception as exc:  # pragma: no cover - import error shown at runtime on VM
    WhisperModel = None
    FASTER_WHISPER_IMPORT_ERROR = exc
else:
    FASTER_WHISPER_IMPORT_ERROR = None


TRANSCRIPT_BRIDGE_TOKEN = os.getenv("TRANSCRIPT_BRIDGE_TOKEN", "").strip()
WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "small").strip() or "small"
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu").strip() or "cpu"
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8").strip() or "int8"

app = FastAPI(title="Oracle Transcript Service")


class TranscriptRequest(BaseModel):
    videoUrl: HttpUrl


def extract_youtube_video_id(video_url: str) -> str:
    match = re.search(r"(?:v=|youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{11})", video_url)
    if not match:
        raise HTTPException(status_code=400, detail="Could not extract a YouTube video ID from that URL.")
    return match.group(1)


def require_auth(authorization: Optional[str]):
    if not TRANSCRIPT_BRIDGE_TOKEN:
        return

    expected = f"Bearer {TRANSCRIPT_BRIDGE_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized transcript bridge request.")


@lru_cache(maxsize=1)
def get_whisper_model():
    if WhisperModel is None:
        raise RuntimeError(
            "faster-whisper could not be imported on this VM. "
            f"Original error: {FASTER_WHISPER_IMPORT_ERROR}"
        )

    return WhisperModel(
        WHISPER_MODEL_SIZE,
        device=WHISPER_DEVICE,
        compute_type=WHISPER_COMPUTE_TYPE
    )


def download_audio(video_url: str) -> str:
    temp_dir = tempfile.mkdtemp(prefix="yt-audio-")
    output_template = os.path.join(temp_dir, "audio.%(ext)s")

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "quiet": True,
        "noplaylist": True,
        "nocheckcertificate": True,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "128"
            }
        ]
    }

    try:
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_url])

        for filename in os.listdir(temp_dir):
            if filename.startswith("audio."):
                return os.path.join(temp_dir, filename)

        raise RuntimeError("Audio download finished, but no audio file was produced.")
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise


def transcribe_audio(audio_path: str):
    model = get_whisper_model()
    segments, info = model.transcribe(audio_path, vad_filter=True, beam_size=5)
    parts = [segment.text.strip() for segment in segments if segment.text.strip()]
    return {
        "rawTranscript": " ".join(parts).strip(),
        "transcriptLanguage": getattr(info, "language", None)
    }


def cleanup_file(file_path: str):
    temp_dir = os.path.dirname(file_path)
    shutil.rmtree(temp_dir, ignore_errors=True)


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "oracle-transcript-service",
        "whisperModel": WHISPER_MODEL_SIZE,
        "device": WHISPER_DEVICE,
        "computeType": WHISPER_COMPUTE_TYPE
    }


@app.post("/transcript")
def transcript(payload: TranscriptRequest, authorization: Optional[str] = Header(default=None)):
    require_auth(authorization)

    video_id = extract_youtube_video_id(str(payload.videoUrl))
    audio_path = download_audio(str(payload.videoUrl))
    try:
        transcript_payload = transcribe_audio(audio_path)
        if not transcript_payload["rawTranscript"]:
            raise HTTPException(status_code=500, detail="Transcription completed but returned no text.")

        return {
            "videoId": video_id,
            **transcript_payload
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        cleanup_file(audio_path)
