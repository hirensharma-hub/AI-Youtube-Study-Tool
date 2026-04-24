# Oracle Transcript Service

This service is meant to run on an Oracle VM and expose:

- `GET /health`
- `POST /transcript`

It downloads YouTube audio with `yt-dlp`, extracts audio via `ffmpeg`, transcribes with `faster-whisper`, and returns plain transcript JSON to the main app.

## Expected request

```json
{
  "videoUrl": "https://www.youtube.com/watch?v=..."
}
```

## Expected response

```json
{
  "rawTranscript": "Full transcript text...",
  "transcriptLanguage": "en"
}
```

## Environment variables

- `TRANSCRIPT_BRIDGE_TOKEN`
  - Optional Bearer token expected by the service
- `WHISPER_MODEL_SIZE`
  - Default: `small`
- `WHISPER_DEVICE`
  - Default: `cpu`
- `WHISPER_COMPUTE_TYPE`
  - Default: `int8`

## Run locally on the VM

```bash
cd oracle-transcript-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
TRANSCRIPT_BRIDGE_TOKEN=your-token uvicorn app:app --host 0.0.0.0 --port 4318
```
