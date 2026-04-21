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

## Environment variables

Copy `.env.example` to `.env.local`:

```bash
APP_URL=http://localhost:3000
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=turbo_cloud_chat
SESSION_SECRET=replace-with-a-long-random-secret
ENCRYPTION_SECRET=replace-with-a-different-long-random-secret
OLLAMA_API_URL=https://ollama.com/v1/chat/completions
OLLAMA_API_KEY=replace-with-your-ollama-cloud-api-key
OLLAMA_MODEL=deepseek-v3.1:671b-cloud
```

### Notes

- `MONGODB_URI`
  - Your MongoDB Atlas connection string
- `OLLAMA_API_URL`
  - The Ollama Cloud OpenAI-compatible chat endpoint
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
