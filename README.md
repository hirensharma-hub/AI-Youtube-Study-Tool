# YouTube Study Tool

A full-stack learning app that turns a YouTube video into:

- clean revision notes
- a study quiz
- topic-aware follow-up Q&A
- AI-marked written responses

It stores user accounts and processed videos in MongoDB Atlas, while all AI generation runs through Ollama Cloud.

## Core flow

1. Paste a YouTube URL.
2. The backend extracts the video transcript.
3. The transcript is cleaned for educational content only.
4. The app generates:
   - revision notes
   - topic-aware Q&A
5. The quiz is generated on demand from the same processed lesson.
6. Processed videos are cached in MongoDB to avoid duplicate work.

## Main routes

- `POST /api/process-video`
  - Extracts transcript, cleans it, and generates notes
- `POST /api/generate-quiz`
  - Builds the quiz separately from an already processed lesson
- `POST /api/ask-question`
  - Answers a question using the lesson topic, notes, and transcript context
- `POST /api/grade-question`
  - Marks written responses against the generated mark scheme
- `GET /api/me`
  - Loads user settings
- `POST /api/settings`
  - Saves theme, model, temperature, and token limits
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`

## Main files

- `src/components/chat/chat-workspace.tsx`
  - Main YouTube study UI with tabs for Notes, Quiz, and Ask Questions
- `src/app/api/process-video/route.ts`
  - Video processing pipeline
- `src/app/api/ask-question/route.ts`
  - Topic-aware lesson Q&A endpoint
- `src/app/api/grade-question/route.ts`
  - Written-answer marking endpoint
- `src/lib/youtube.ts`
  - YouTube URL parsing and transcript fetching
- `src/lib/ai.ts`
  - Ollama Cloud requests and quiz parsing helpers
- `src/lib/quiz.ts`
  - Quiz generation helpers used by the on-demand quiz route
- `src/lib/server-data.ts`
  - MongoDB-backed user settings and processed-video cache
- `oracle-transcript-service/app.py`
  - Optional Oracle-hosted audio-to-transcript microservice for YouTube URLs

## Environment variables

Copy `.env.example` to `.env.local`:

```bash
APP_URL=http://localhost:3000
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=turbo_cloud_chat
SESSION_SECRET=replace-with-a-long-random-secret
ENCRYPTION_SECRET=replace-with-a-different-long-random-secret
TRANSCRIPT_BRIDGE_URL=
TRANSCRIPT_BRIDGE_TOKEN=
OLLAMA_API_URL=https://ollama.com/v1/chat/completions
OLLAMA_API_KEY=replace-with-your-ollama-cloud-api-key
OLLAMA_MODEL=deepseek-v3.1:671b-cloud
```

### Notes

- `MONGODB_URI`
  - Your MongoDB Atlas connection string
- `OLLAMA_API_URL`
  - The Ollama Cloud OpenAI-compatible chat endpoint
- `TRANSCRIPT_BRIDGE_URL`
  - Optional URL of your Oracle-hosted transcript service
- `TRANSCRIPT_BRIDGE_TOKEN`
  - Optional Bearer token shared with your transcript service
- `OLLAMA_API_KEY`
  - Your Ollama Cloud API key
- `OLLAMA_MODEL`
  - The preferred Ollama Cloud model. The app will try the strongest cloud model first and automatically fall back to `gpt-oss:120b-cloud` if needed.

## Local setup

1. Create an Ollama account and API key from [Ollama](https://ollama.com/).
2. Copy `.env.example` to `.env.local` and fill in your MongoDB and Ollama values.
3. Start the app:

```bash
cd "/Users/hiren/Documents/New project"
npm install
cp .env.example .env.local
npm run dev
```

Open the local URL shown in the terminal and sign in.

## Optional local transcript bridge

If your cloud deployment cannot fetch YouTube captions reliably, you can let the user's own Mac retrieve the transcript instead. The website will automatically try a local bridge on `http://127.0.0.1:4318` before falling back to cloud-side fetching.

The bridge now uses a browser-identity strategy:

- fetch the full YouTube watch page
- extract `ytInitialPlayerResponse` from the HTML
- read caption metadata from that JSON
- request captions as `fmt=vtt`
- strip WEBVTT metadata into plain transcript text

To avoid repeated redeploys, do **not** hardcode cookies into the bridge. Use one of these instead:

1. `TRANSCRIPT_BRIDGE_COOKIE`
   - set a full browser cookie string as an environment variable
2. `cookies.json`
   - place a JSON file next to the project root and the bridge will load it automatically

Supported `cookies.json` formats:

```json
[
  { "name": "SID", "value": "..." },
  { "name": "HSID", "value": "..." }
]
```

or

```json
{
  "SID": "...",
  "HSID": "..."
}
```

Run it manually:

```bash
cd "/Users/hiren/Documents/New project"
npm run transcript-bridge
```

Install it once so it starts automatically when you log in on macOS:

```bash
cd "/Users/hiren/Documents/New project"
npm run install-transcript-bridge-macos
launchctl unload ~/Library/LaunchAgents/com.aiyoutube.study.transcript-bridge.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.aiyoutube.study.transcript-bridge.plist
```

Useful bridge env vars:

```bash
TRANSCRIPT_BRIDGE_COOKIE="SID=...; HSID=..."
TRANSCRIPT_BRIDGE_COOKIE_FILE=/absolute/path/to/cookies.json
TRANSCRIPT_BRIDGE_USER_AGENT="Mozilla/5.0 ..."
TRANSCRIPT_BRIDGE_REFERER="https://www.youtube.com/"
```

## Optional Oracle transcript service

If Vercel cannot fetch YouTube transcripts reliably, you can run a transcript service on an Oracle VM instead.

Files:

- `oracle-transcript-service/app.py`
- `oracle-transcript-service/requirements.txt`

On the Oracle VM:

```bash
sudo dnf install -y python3 python3-pip ffmpeg git
git clone https://github.com/hirensharma-hub/AI-Youtube-Study-Tool.git
cd AI-Youtube-Study-Tool/oracle-transcript-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
TRANSCRIPT_BRIDGE_TOKEN=your-token uvicorn app:app --host 0.0.0.0 --port 4318
```

Then point the main app at it with:

```bash
TRANSCRIPT_BRIDGE_URL=http://YOUR_ORACLE_VM_IP:4318
TRANSCRIPT_BRIDGE_TOKEN=your-token
```

## Product behavior

- The homepage is no longer a chatbot
- The primary input is a YouTube URL
- Notes are the default output tab
- Quizzes are generated on demand so the main study-pack flow stays faster
- Chat exists only in the `Ask Questions` tab
- Q&A can answer topic-related questions at the same lesson level
- Written questions are AI-marked against generated mark schemes
- Processed videos are cached to reduce duplicate work

## Verification

Verified locally with:

```bash
npx tsc --noEmit
```
