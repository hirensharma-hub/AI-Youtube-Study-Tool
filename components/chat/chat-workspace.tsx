"use client";

import { fetchTranscriptClient } from "@/utils/fetchTranscriptClient";
import { useRouter } from "next/navigation";
import {
  Fragment,
  FormEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { providerCatalog } from "@/config/ai-providers";
import {
  ProcessedVideo,
  ProviderCatalogItem,
  QuestionAnswerMessage,
  ShortAnswerGrade,
  UserSettings,
  ViewerUser
} from "@/types";

interface LearningWorkspaceProps {
  initialUser: ViewerUser;
  initialSettings: UserSettings;
}

type ActiveTab = "notes" | "flashcards" | "quiz" | "questions";
type QuizSelectionsByVideo = Record<string, Record<string, string>>;
type QuizRevealByVideo = Record<string, Record<string, boolean>>;
type QuizProgressByVideo = Record<string, number>;
type QuizShortAnswersByVideo = Record<string, Record<string, string>>;
type QuizGradesByVideo = Record<string, Record<string, ShortAnswerGrade>>;
type ProcessingState = {
  taskId: string;
  stage: string;
  detail: string;
  progress: number;
};

function applyTheme(theme: UserSettings["theme"]) {
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
    window.localStorage.setItem("turbo-cloud-chat-theme", "system");
    return;
  }

  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem("turbo-cloud-chat-theme", theme);
}

function getVideoStub(videoUrl: string) {
  return videoUrl.replace(/^https?:\/\//, "").slice(0, 58);
}

function renderInlineText(text: string, keyPrefix: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (!part) return null;

    const boldMatch = part.match(/^\*\*([\s\S]+)\*\*$/);
    if (boldMatch) {
      return (
        <strong key={`${keyPrefix}-bold-${index}`}>
          {boldMatch[1]}
        </strong>
      );
    }

    return <Fragment key={`${keyPrefix}-text-${index}`}>{part}</Fragment>;
  });
}

function parseTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSpecialBlockStart(line: string) {
  return (
    /^---+$/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    (/^\*\*.+\*\*$/.test(line) && !line.includes(":")) ||
    /^\|/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line)
  );
}

function renderRichStudyText(text: string): ReactNode[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];

  for (let index = 0; index < lines.length; ) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line) {
      index += 1;
      continue;
    }

    if (/^---+$/.test(line)) {
      blocks.push(<hr key={`hr-${index}`} className="learning-divider" />);
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length + 1, 6);
      const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements;
      blocks.push(
        <HeadingTag
          key={`heading-${index}`}
          className={`learning-heading learning-heading-${level}`}
        >
          {renderInlineText(headingMatch[2].trim(), `heading-${index}`)}
        </HeadingTag>
      );
      index += 1;
      continue;
    }

    if (/^\*\*.+\*\*$/.test(line) && !line.includes(":")) {
      const title = line.replace(/^\*\*|\*\*$/g, "").trim();
      blocks.push(
        <h2
          key={`title-${index}`}
          className="learning-heading learning-heading-feature"
        >
          {title}
        </h2>
      );
      index += 1;
      continue;
    }

    if (/^\|/.test(line)) {
      const tableLines: string[] = [];

      while (index < lines.length && /^\|/.test(lines[index].trim())) {
        tableLines.push(lines[index].trim());
        index += 1;
      }

      const rows = tableLines
        .filter((row) => !/^\|\s*[-:|\s]+\|?$/.test(row))
        .map(parseTableRow)
        .filter((cells) => cells.length > 0);

      if (rows.length) {
        const [header, ...body] = rows;
        blocks.push(
          <div key={`table-${index}`} className="learning-table-wrap">
            <table className="learning-table">
              <thead>
                <tr>
                  {header.map((cell, cellIndex) => (
                    <th key={`table-head-${cellIndex}`}>
                      {renderInlineText(cell, `table-head-${cellIndex}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              {body.length ? (
                <tbody>
                  {body.map((row, rowIndex) => (
                    <tr key={`table-row-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`table-cell-${rowIndex}-${cellIndex}`}>
                          {renderInlineText(
                            cell,
                            `table-cell-${rowIndex}-${cellIndex}`
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ) : null}
            </table>
          </div>
        );
      }

      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];

      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ul key={`list-${index}`} className="learning-list">
          {items.map((item, itemIndex) => (
            <li key={`list-item-${itemIndex}`}>
              {renderInlineText(item, `list-item-${itemIndex}`)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];

      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ol
          key={`ordered-list-${index}`}
          className="learning-list learning-list-ordered"
        >
          {items.map((item, itemIndex) => (
            <li key={`ordered-list-item-${itemIndex}`}>
              {renderInlineText(item, `ordered-list-item-${itemIndex}`)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    const paragraphLines = [line];
    index += 1;

    while (index < lines.length) {
      const nextLine = lines[index].trim();
      if (!nextLine || isSpecialBlockStart(nextLine)) break;

      paragraphLines.push(nextLine);
      index += 1;
    }

    blocks.push(
      <p key={`paragraph-${index}`} className="learning-paragraph">
        {renderInlineText(
          paragraphLines.join(" "),
          `paragraph-${index}`
        )}
      </p>
    );
  }

  return blocks;
}

async function getJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({
      error: "Request failed."
    }));
    throw new Error(payload.error || "Request failed.");
  }

  const text = await response.text();
  if (!text.trim()) {
    throw new Error(
      "The server returned an empty response. Please try again."
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("The server returned invalid data. Please try again.");
  }
}

export function LearningWorkspace({
  initialUser,
  initialSettings
}: LearningWorkspaceProps) {
  const router = useRouter();
  const qaEndRef = useRef<HTMLDivElement | null>(null);

  const [user] = useState(initialUser);
  const [provider] = useState<ProviderCatalogItem>(providerCatalog.ollama);
  const [settings, setSettings] = useState<UserSettings>(initialSettings);
  const [settingsDraft, setSettingsDraft] = useState<UserSettings>(initialSettings);

  const [videoUrlInput, setVideoUrlInput] = useState("");
  const [activeVideo, setActiveVideo] = useState<ProcessedVideo | null>(null);
  const [videoCache, setVideoCache] = useState<Record<string, ProcessedVideo>>({});
  const [qaCache, setQaCache] = useState<Record<string, QuestionAnswerMessage[]>>({});
  const [quizSelections, setQuizSelections] = useState<QuizSelectionsByVideo>({});
  const [quizRevealed, setQuizRevealed] = useState<QuizRevealByVideo>({});
  const [quizProgress, setQuizProgress] = useState<QuizProgressByVideo>({});
  const [quizShortAnswers, setQuizShortAnswers] = useState<QuizShortAnswersByVideo>({});
  const [quizGrades, setQuizGrades] = useState<QuizGradesByVideo>({});

  const [activeTab, setActiveTab] = useState<ActiveTab>("notes");
  const [questionDraft, setQuestionDraft] = useState("");

  const [processing, setProcessing] = useState(false);
  const [processingState, setProcessingState] = useState<ProcessingState | null>(null);

  const [asking, setAsking] = useState(false);
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [generatingFlashcards, setGeneratingFlashcards] = useState(false);
  const [gradingQuiz, setGradingQuiz] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [error, setError] = useState("");

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    qaEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end"
    });
  }, [qaCache, asking]);

  const qaMessages = useMemo(
    () => (activeVideo ? qaCache[activeVideo.videoId] ?? [] : []),
    [activeVideo, qaCache]
  );
  const activeQuizIndex = useMemo(() => {
    if (!activeVideo) return 0;
    return quizProgress[activeVideo.videoId] ?? 0;
  }, [activeVideo, quizProgress]);

  const activeQuizQuestion = useMemo(() => {
    if (!activeVideo) return null;
    return activeVideo.quiz[activeQuizIndex] ?? null;
  }, [activeVideo, activeQuizIndex]);

  const activeQuizSelection = useMemo(() => {
    if (!activeVideo || !activeQuizQuestion) return "";
    return quizSelections[activeVideo.videoId]?.[activeQuizQuestion.id] ?? "";
  }, [activeVideo, activeQuizQuestion, quizSelections]);

  const activeQuizIsRevealed = useMemo(() => {
    if (!activeVideo || !activeQuizQuestion) return false;
    return quizRevealed[activeVideo.videoId]?.[activeQuizQuestion.id] ?? false;
  }, [activeVideo, activeQuizQuestion, quizRevealed]);

  const activeQuizShortAnswer = useMemo(() => {
    if (!activeVideo || !activeQuizQuestion) return "";
    return quizShortAnswers[activeVideo.videoId]?.[activeQuizQuestion.id] ?? "";
  }, [activeVideo, activeQuizQuestion, quizShortAnswers]);

  const activeQuizGrade = useMemo(() => {
    if (!activeVideo || !activeQuizQuestion) return null;
    return quizGrades[activeVideo.videoId]?.[activeQuizQuestion.id] ?? null;
  }, [activeVideo, activeQuizQuestion, quizGrades]);

  const answeredQuizCount = useMemo(() => {
    if (!activeVideo) return 0;
    return Object.keys(quizRevealed[activeVideo.videoId] ?? {}).length;
  }, [activeVideo, quizRevealed]);

  const quizCorrectCount = useMemo(() => {
    if (!activeVideo) return 0;
    const revealed = quizRevealed[activeVideo.videoId] ?? {};
    const selections = quizSelections[activeVideo.videoId] ?? {};

    return activeVideo.quiz.reduce((count, question) => {
      if (!revealed[question.id]) return count;
      if (question.type === "mcq") {
        if (selections[question.id] === question.correctOptionId) {
          return count + 1;
        }
      }
      return count;
    }, 0);
  }, [activeVideo, quizRevealed, quizSelections]);

  async function handleProcessVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedUrl = videoUrlInput.trim();
    if (!trimmedUrl) return;

    setError("");
    setProcessing(true);
    setProcessingState({
      taskId: "init",
      stage: "transcript",
      detail: "Routing through open data gateways to secure subtitles...",
      progress: 10
    });
    
    try {
      // 1. Extract video ID safely
      const match = trimmedUrl.match(/v=([^&]+)/) || trimmedUrl.match(/youtu\.be\/([^?&]+)/);
      const videoId = match ? match[1] : null;
      if (!videoId) {
        throw new Error("Invalid YouTube URL format.");
      }

      // 2. CORS-BYPASS ENGINE: Wrap targets using a proxy gateway to bypass origin security blocks
      const targetUrls = [
        `https://pipedapi.kavin.rocks/streams/${videoId}`,
        `https://pipedapi.adminforge.de/streams/${videoId}`
      ];

      let subtitles: any[] | null = null;

      for (const target of targetUrls) {
        try {
          console.log(`Trying extraction source via CORS gateway: ${target}`);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 7000);

          const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(target)}`, { 
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (res.ok) {
            const data = await res.json().catch(() => null);
            if (data && data.subtitles && data.subtitles.length > 0) {
              const trackTarget = data.subtitles.find((s: any) => s.code?.startsWith("en")) || data.subtitles[0];
              
              if (trackTarget && trackTarget.url) {
                const vttRes = await fetch(`https://corsproxy.io/?${encodeURIComponent(trackTarget.url)}`);
                if (vttRes.ok) {
                  const vttText = await vttRes.text();
                  const items: any[] = [];
                  const blocks = vttText.split("\n\n");
                  
                  let fallbackTime = 0;
                  for (const block of blocks) {
                    if (block.includes("-->")) {
                      const lines = block.split("\n");
                      const textLine = lines.slice(1).join(" ").trim();
                      if (textLine) {
                        items.push({
                          text: textLine.replace(/<[^>]*>/g, ""),
                          start: fallbackTime,
                          duration: 3
                        });
                        fallbackTime += 3;
                      }
                    }
                  }
                  if (items.length > 0) {
                    subtitles = items;
                    break;
                  }
                }
              }
            }
          }
        } catch (e) {
          console.warn(`Gateway route rejected or timed out for target: ${target}`, e);
        }
      }

      if (!subtitles || subtitles.length === 0) {
        throw new Error("All unblocked proxy gateways are currently saturated. Please try another video or try again in a few seconds.");
      }

      const fullTranscriptText = subtitles.map((s: any) => s.text).join(" ");

      setProcessingState({
        taskId: "init",
        stage: "notes",
        detail: "Transcript secured! Triggering AI background orchestration pipeline...",
        progress: 30
      });

      // 3. Forward the transcript data to the process-video endpoint
      const processedResponse = await fetch("/api/process-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: trimmedUrl,
          transcript: {
            videoId: videoId,
            rawTranscript: fullTranscriptText,
            transcriptLanguage: "en"
          }
        })
      });

      if (!processedResponse.ok) {
        const err = await processedResponse.json().catch(() => ({}));
        throw new Error(err.error || "Processing pipeline initialization failed.");
      }

      const initialResult = await processedResponse.json();
      let finalVideoData: ProcessedVideo | null = null;

      if (initialResult.done && initialResult.video) {
        finalVideoData = initialResult.video;
      } else if (initialResult.taskId) {
        const currentTaskId = initialResult.taskId;
        let isCompleted = false;

        while (!isCompleted) {
          await new Promise((resolve) => setTimeout(resolve, 2500));

          const pollResponse = await fetch(`/api/process-video?taskId=${currentTaskId}`);
          if (!pollResponse.ok) {
            const err = await pollResponse.json().catch(() => ({}));
            throw new Error(err.error || "Error monitoring your study pack creation.");
          }

          const taskStatus = await pollResponse.json();

          if (taskStatus.status === "completed") {
            finalVideoData = taskStatus.video;
            isCompleted = true;
          } else if (taskStatus.status === "failed") {
            throw new Error(taskStatus.error || "AI background generation failed.");
          } else {
            setProcessingState({
              taskId: currentTaskId,
              stage: taskStatus.stage || "notes",
              detail: taskStatus.detail || "Refining your lesson materials...",
              progress: Math.min(98, Math.max(35, taskStatus.progress || 35))
            });
          }
        }
      }

      if (!finalVideoData) {
        throw new Error("Pipeline terminated without delivering a valid study pack.");
      }

      setActiveVideo(finalVideoData);
      setVideoCache((current) => ({
        ...current,
        [finalVideoData!.videoId]: finalVideoData!
      }));

      setQuizProgress((current) => ({ ...current, [finalVideoData!.videoId]: 0 }));
      setQuizSelections((current) => ({ ...current, [finalVideoData!.videoId]: {} }));
      setQuizRevealed((current) => ({ ...current, [finalVideoData!.videoId]: {} }));
      setQuizShortAnswers((current) => ({ ...current, [finalVideoData!.videoId]: {} }));
      setQuizGrades((current) => ({ ...current, [finalVideoData!.videoId]: {} }));

      setActiveTab("notes");
    } catch (processError) {
      setError(
        processError instanceof Error
          ? processError.message
          : "Unable to process this video."
      );
    } finally {
      setProcessing(false);
      setProcessingState(null);
    }
  }

  function handleSelectQuizOption(questionId: string, optionId: string) {
    if (!activeVideo) return;

    setQuizSelections((current) => ({
      ...current,
      [activeVideo.videoId]: {
        ...(current[activeVideo.videoId] ?? {}),
        [questionId]: optionId
      }
    }));
  }

  function handleShortAnswerChange(questionId: string, text: string) {
    if (!activeVideo) return;

    setQuizShortAnswers((current) => ({
      ...current,
      [activeVideo.videoId]: {
        ...(current[activeVideo.videoId] ?? {}),
        [questionId]: text
      }
    }));
  }

  async function handleSubmitQuizAnswer() {
    if (!activeVideo || !activeQuizQuestion) return;

    const videoId = activeVideo.videoId;
    const question = activeQuizQuestion;

    if (question.type === "mcq") {
      setQuizRevealed((current) => ({
        ...current,
        [videoId]: {
          ...(current[videoId] ?? {}),
          [question.id]: true
        }
      }));
      return;
    }

    const answer = activeQuizShortAnswer.trim();
    if (!answer) return;

    setGradingQuiz(true);

    try {
      const data = await getJson<{ grade: ShortAnswerGrade }>(
        "/api/grade-answer",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            videoId,
            questionId: question.id,
            answer
          })
        }
      );

      setQuizGrades((current) => ({
        ...current,
        [videoId]: {
          ...(current[videoId] ?? {}),
          [question.id]: data.grade
        }
      }));

      setQuizRevealed((current) => ({
        ...current,
        [videoId]: {
          ...(current[videoId] ?? {}),
          [question.id]: true
        }
      }));
    } catch (err) {
      setError("Unable to grade this answer.");
    } finally {
      setGradingQuiz(false);
    }
  }

  function handleNextQuizQuestion() {
    if (!activeVideo) return;

    setQuizProgress((current) => ({
      ...current,
      [activeVideo.videoId]: activeQuizIndex + 1
    }));
  }

  function handleRestartQuiz() {
    if (!activeVideo) return;

    const videoId = activeVideo.videoId;

    setQuizProgress((current) => ({
      ...current,
      [videoId]: 0
    }));
    setQuizSelections((current) => ({
      ...current,
      [videoId]: {}
    }));
    setQuizRevealed((current) => ({
      ...current,
      [videoId]: {}
    }));
    setQuizShortAnswers((current) => ({
      ...current,
      [videoId]: {}
    }));
    setQuizGrades((current) => ({
      ...current,
      [videoId]: {}
    }));
  }

  async function handleGenerateQuiz() {
    if (!activeVideo) return;

    setGeneratingQuiz(true);
    setError("");

    try {
      const data = await getJson<{ quiz: ProcessedVideo["quiz"] }>(
        "/api/generate-quiz",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            videoId: activeVideo.videoId
          })
        }
      );

      const updated = {
        ...activeVideo,
        quiz: data.quiz
      };

      setActiveVideo(updated);
      setVideoCache((current) => ({
        ...current,
        [updated.videoId]: updated
      }));

      setQuizProgress((current) => ({
        ...current,
        [updated.videoId]: 0
      }));
      setQuizSelections((current) => ({
        ...current,
        [updated.videoId]: {}
      }));
      setQuizRevealed((current) => ({
        ...current,
        [updated.videoId]: {}
      }));
      setQuizShortAnswers((current) => ({
        ...current,
        [updated.videoId]: {}
      }));
      setQuizGrades((current) => ({
        ...current,
        [updated.videoId]: {}
      }));
    } catch (err) {
      setError("Unable to generate quiz.");
    } finally {
      setGeneratingQuiz(false);
    }
  }

  async function handleGenerateFlashcards() {
    if (!activeVideo) return;

    setGeneratingFlashcards(true);
    setError("");

    try {
      const data = await getJson<{ flashcards: ProcessedVideo["flashcards"] }>(
        "/api/generate-flashcards",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            videoId: activeVideo.videoId
          })
        }
      );

      const updated = {
        ...activeVideo,
        flashcards: data.flashcards
      };

      setActiveVideo(updated);
      setVideoCache((current) => ({
        ...current,
        [updated.videoId]: updated
      }));
    } catch (err) {
      setError("Unable to generate flashcards.");
    } finally {
      setGeneratingFlashcards(false);
    }
  }

  async function handleAskQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeVideo) return;

    const trimmed = questionDraft.trim();
    if (!trimmed) return;

    setAsking(true);
    setError("");

    const videoId = activeVideo.videoId;

    setQaCache((current) => ({
      ...current,
      [videoId]: [
        ...(current[videoId] ?? []),
        {
          id: crypto.randomUUID(),
          role: "user",
          content: trimmed,
          createdAt: new Date().toISOString()
        }
      ]
    }));

    setQuestionDraft("");

    try {
      const data = await getJson<{ message: QuestionAnswerMessage }>(
        "/api/ask-question",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            videoId,
            question: trimmed
          })
        }
      );

      setQaCache((current) => ({
        ...current,
        [videoId]: [
          ...(current[videoId] ?? []),
          data.message
        ]
      }));
    } catch (qaError) {
      setError(
        qaError instanceof Error
          ? qaError.message
          : "Unable to answer this question."
      );
    } finally {
      setAsking(false);
    }
  }

  async function handleSaveSettings() {
    setSavingSettings(true);
    setError("");

    try {
      const data = await getJson<{ settings: UserSettings }>(
        "/api/save-settings",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settingsDraft)
        }
      );

      setSettings(data.settings);
      setSettingsOpen(false);
    } catch (err) {
      setError("Unable to save settings.");
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <main className="workspace">
      <header className="workspace-header">
        <div className="workspace-header-left">
          <h1 className="workspace-title">LessonLift</h1>
          <form className="video-form" onSubmit={handleProcessVideo}>
            <input
              className="video-input"
              placeholder="Paste a YouTube link..."
              value={videoUrlInput}
              onChange={(event) => setVideoUrlInput(event.target.value)}
            />
            <button
              className="button button-primary"
              disabled={processing}
              type="submit"
            >
              {processing ? "Processing..." : "Load"}
            </button>
          </form>
        </div>

        <div className="workspace-header-right">
          <button
            className="button button-secondary"
            onClick={() => setSettingsOpen(true)}
            type="button"
          >
            Settings
          </button>
          <button
            className="button button-secondary"
            onClick={() => router.push("/logout")}
            type="button"
          >
            Log out
          </button>
        </div>
      </header>

      {error ? (
        <p className="error-text workspace-error">{error}</p>
      ) : null}

      <section className="workspace-body">
        {processing ? (
          <section className="learning-status panel">
            <div className="learning-status-badge">Processing video</div>
            <div>
              <h2>Building your study pack</h2>
              <p className="muted">
                {processingState?.detail ??
                  "Extracting the transcript, preparing the lesson, generating notes, and building the quiz."}
              </p>
              <div className="learning-progress-track" aria-hidden="true">
                <div
                  className="learning-progress-fill"
                  style={{
                    width: `${Math.max(
                      4,
                      processingState?.progress ?? 6
                    )}%`
                  }}
                />
              </div>
            </div>
            <div className="learning-status-steps">
              <span
                className={
                  processingState?.stage === "transcript"
                    ? "is-active"
                    : ""
                }
              >
                Transcript
              </span>
              <span
                className={
                  processingState?.stage === "cleaning" ||
                  processingState?.stage === "notes"
                    ? "is-active"
                    : ""
                }
              >
                Notes
              </span>
              <span
                className={
                  processingState?.stage === "mcq" ||
                  processingState?.stage === "written"
                    ? "is-active"
                    : ""
                }
              >
                Quiz
              </span>
              <span
                className={
                  processingState?.stage === "saving" ||
                  processingState?.stage === "completed"
                    ? "is-active"
                    : ""
                }
              >
                Finalizing
              </span>
            </div>
          </section>
        ) : null}

        {activeVideo ? (
          <>
            <section className="learning-video-summary panel">
              <div>
                <p className="muted sidebar-eyebrow">Current lesson</p>
                <h2>{activeVideo.title}</h2>
                <p className="muted">{activeVideo.videoUrl}</p>
              </div>
              <div className="learning-meta-stack">
                <span className="learning-pill">Video ID: {activeVideo.videoId}</span>
                {activeVideo.transcriptLanguage ? (
                  <span className="learning-pill">Transcript: {activeVideo.transcriptLanguage}</span>
                ) : null}
                <span className="learning-pill">
                  {activeVideo.quiz.length
                    ? `Quiz progress: ${answeredQuizCount}/${activeVideo.quiz.length}`
                    : "Quiz unavailable"}
                </span>
              </div>
            </section>

            <nav className="panel learning-tabs-shell">
              <div className="learning-tabs">
                <button
                  className={`learning-tab ${activeTab === "notes" ? "is-active" : ""}`}
                  onClick={() => setActiveTab("notes")}
                  type="button"
                >
                  Notes
                </button>
                <button
                  className={`learning-tab ${activeTab === "flashcards" ? "is-active" : ""}`}
                  onClick={() => setActiveTab("flashcards")}
                  type="button"
                >
                  Flashcards
                </button>
                <button
                  className={`learning-tab ${activeTab === "quiz" ? "is-active" : ""}`}
                  onClick={() => setActiveTab("quiz")}
                  type="button"
                >
                  Quiz
                </button>
                <button
                  className={`learning-tab ${activeTab === "questions" ? "is-active" : ""}`}
                  onClick={() => setActiveTab("questions")}
                  type="button"
                >
                  Ask Questions
                </button>
              </div>
              <div className="learning-tab-summary muted">
                {activeTab === "notes"
                  ? "Structured notes built from the processed transcript"
                  : activeTab === "flashcards"
                  ? activeVideo.flashcards.length
                    ? "Flip through quick GCSE revision prompts and answers"
                    : "Generate flashcards for this lesson"
                  : activeTab === "quiz"
                  ? activeVideo.quiz.length
                    ? "Answer each question before the explanation appears"
                    : "Generate or regenerate the quiz for this lesson"
                  : "Ask only from the lesson transcript"}
              </div>
            </nav>

            <section className="learning-content panel">
              {activeTab === "notes" ? (
                <article className="learning-rich-text">
                  {renderRichStudyText(activeVideo.notes)}
                </article>
              ) : null}

              {activeTab === "flashcards" ? (
                <div className="flashcards-layout">
                  {!activeVideo.flashcards.length ? (
                    <article className="quiz-card quiz-card-active">
                      <div className="empty-state">
                        <p>Generate flashcards when you are ready.</p>
                        <p className="muted">
                          Flashcards are built from the same cleaned transcript and notes, but kept short for fast revision.
                        </p>
                        <button
                          className="button button-primary"
                          disabled={generatingFlashcards}
                          onClick={handleGenerateFlashcards}
                          type="button"
                        >
                          {generatingFlashcards ? "Generating flashcards..." : "Generate flashcards"}
                        </button>
                      </div>
                    </article>
                  ) : (
                    <div className="flashcards-grid">
                      {activeVideo.flashcards.map((card, index) => (
                        <article className="flashcard-card" key={card.id}>
                          <p className="muted sidebar-eyebrow">Flashcard {index + 1}</p>
                          <h3>{card.front}</h3>
                          <div className="flashcard-answer">
                            <p>{card.back}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {activeTab === "quiz" ? (
                <div className="quiz-grid">
                  <section className="quiz-summary-card">
                    <div>
                      <p className="muted sidebar-eyebrow">Quiz progress</p>
                      <h3>
                        {activeVideo.quiz.length
                          ? `Question ${activeQuizQuestion ? activeQuizIndex + 1 : 0} of ${activeVideo.quiz.length}`
                          : "Quiz unavailable"}
                      </h3>
                    </div>
                    <div className="quiz-summary-meta">
                      <span className="learning-pill">Answered: {answeredQuizCount}</span>
                      <span className="learning-pill">Correct: {quizCorrectCount}</span>
                    </div>
                  </section>

                  {!activeVideo.quiz.length ? (
                    <article className="quiz-card quiz-card-active">
                      <div className="empty-state">
                        <p>Generate the quiz when you are ready.</p>
                        <p className="muted">
                          Notes load first to keep the cloud workflow responsive. The quiz is built separately from the same lesson.
                        </p>
                        <button
                          className="button button-primary"
                          disabled={generatingQuiz}
                          onClick={handleGenerateQuiz}
                          type="button"
                        >
                          {generatingQuiz ? "Generating quiz..." : "Generate quiz"}
                        </button>
                      </div>
                    </article>
                  ) : activeQuizQuestion ? (
                    <article className="quiz-card quiz-card-active">
                      <div className="quiz-question-header">
                        <p className="muted sidebar-eyebrow">
                          {activeQuizQuestion.type === "mcq" ? "Multiple choice" : "Written response"}
                        </p>
                        <span className="quiz-mark-pill">
                          {activeQuizQuestion.markCount} {activeQuizQuestion.markCount === 1 ? "mark" : "marks"}
                        </span>
                      </div>
                      <h3>{activeQuizQuestion.question}</h3>

                      {activeQuizQuestion.type === "mcq" ? (
                        <div className="quiz-options">
                          {activeQuizQuestion.options?.map((option, optionIndex) => {
                            const isSelected = activeQuizSelection === option.id;
                            const isCorrect = activeQuizQuestion.correctOptionId === option.id;
                            const isWrongSelection = activeQuizIsRevealed && isSelected && !isCorrect;
                            const showCorrectState = activeQuizIsRevealed && isCorrect;

                            const optionStateClass = showCorrectState
                              ? "is-correct"
                              : isWrongSelection
                              ? "is-incorrect"
                              : isSelected
                              ? "is-selected"
                              : "";

                            return (
                              <button
                                key={option.id}
                                className={`quiz-option ${optionStateClass}`.trim()}
                                onClick={() => handleSelectQuizOption(activeQuizQuestion.id, option.id)}
                                type="button"
                              >
                                <span className="quiz-option-label">{String.fromCharCode(65 + optionIndex)}</span>
                                <span className="quiz-option-text">{option.text}</span>
                                {showCorrectState ? <span className="quiz-option-icon">✓</span> : null}
                                {isWrongSelection ? <span className="quiz-option-icon">✕</span> : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="quiz-written-block">
                          <textarea
                            className="quiz-written-input"
                            placeholder="Type your exam-style answer here..."
                            rows={6}
                            value={activeQuizShortAnswer}
                            onChange={(event) =>
                              handleShortAnswerChange(activeQuizQuestion.id, event.target.value)
                            }
                          />
                          <p className="muted quiz-written-help">
                            Write a response that matches a {activeQuizQuestion.markCount}-mark answer.
                          </p>
                        </div>
                      )}

                      <div className="quiz-actions">
                        {!activeQuizIsRevealed ? (
                          <button
                            className="button button-primary"
                            disabled={
                              gradingQuiz ||
                              (activeQuizQuestion.type === "mcq"
                                ? !activeQuizSelection
                                : !activeQuizShortAnswer.trim())
                            }
                            onClick={handleSubmitQuizAnswer}
                            type="button"
                          >
                            {activeQuizQuestion.type === "short-answer" && gradingQuiz
                              ? "Marking..."
                              : "Check answer"}
                          </button>
                        ) : (
                          <>
                            <div className="quiz-feedback">
                              {activeQuizQuestion.type === "mcq" ? (
                                <p
                                  className={
                                    activeQuizSelection === activeQuizQuestion.correctOptionId
                                      ? "quiz-feedback-correct"
                                      : "quiz-feedback-wrong"
                                  }
                                >
                                  {activeQuizSelection === activeQuizQuestion.correctOptionId
                                    ? "Correct answer."
                                    : `Incorrect. The correct answer is ${activeQuizQuestion.answer}.`}
                                </p>
                              ) : (
                                <>
                                  <p className="quiz-feedback-neutral">
                                    Awarded {activeQuizGrade?.awardedMarks ?? 0} /{" "}
                                    {activeQuizQuestion.markCount} marks
                                  </p>
                                  <p>{activeQuizGrade?.feedback ?? "No detailed feedback returned yet."}</p>

                                  {activeQuizQuestion.markScheme?.length ? (
                                    <div className="quiz-markscheme">
                                      <p className="quiz-feedback-neutral">Mark scheme breakdown</p>
                                      <div className="quiz-markscheme-points">
                                        {activeQuizQuestion.markScheme.map((point) => {
                                          const gradedPoint = activeQuizGrade?.matchedPoints.find(
                                            (item) => item.pointId === point.id
                                          );

                                          return (
                                            <article
                                              key={point.id}
                                              className={`quiz-markscheme-point ${
                                                gradedPoint?.awarded ? "is-awarded" : "is-missed"
                                              }`}
                                            >
                                              <div className="quiz-markscheme-point-header">
                                                <strong>
                                                  {point.marks} {point.marks === 1 ? "mark" : "marks"} for{" "}
                                                  {point.label}
                                                </strong>
                                                <span>{gradedPoint?.awarded ? "Awarded" : "Not awarded"}</span>
                                              </div>
                                              <p className="muted">
                                                Allow: {point.acceptedAnswers.join(" / ")}
                                              </p>
                                              <p>{gradedPoint?.reason ?? "No specific reason returned."}</p>
                                            </article>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ) : null}

                                  <p className="quiz-feedback-neutral">Suggested full-mark answer:</p>
                                  <div className="quiz-model-answer">
                                    <p>{activeQuizQuestion.answer}</p>
                                  </div>
                                </>
                              )}

                              <p className="muted">{activeQuizQuestion.explanation}</p>
                            </div>

                            {activeQuizIndex < activeVideo.quiz.length - 1 ? (
                              <button
                                className="button button-primary"
                                onClick={handleNextQuizQuestion}
                                type="button"
                              >
                                Next question
                              </button>
                            ) : (
                              <button
                                className="button button-secondary"
                                onClick={handleRestartQuiz}
                                type="button"
                              >
                                Restart quiz
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </article>
                  ) : null}
                </div>
              ) : null}

              {activeTab === "questions" ? (
                <div className="qa-layout">
                  <div className="qa-history">
                    {qaMessages.length ? (
                      qaMessages.map((message) => (
                        <article
                          key={message.id}
                          className={`message-row ${
                            message.role === "user" ? "is-user" : "is-assistant"
                          }`}
                        >
                          <div className="message-bubble">
                            <div className="message-meta">
                              <strong>
                                {message.role === "user" ? "You" : "Lesson AI"}
                              </strong>
                            </div>
                            <p>{message.content}</p>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="empty-state">
                        <p>Ask a question about this video.</p>
                        <p className="muted">
                          Answers will use only the processed transcript and no
                          outside knowledge.
                        </p>
                      </div>
                    )}
                    <div ref={qaEndRef} />
                  </div>

                  <form className="composer" onSubmit={handleAskQuestion}>
                    <textarea
                      className="composer-input"
                      placeholder="Ask about the video content..."
                      rows={3}
                      value={questionDraft}
                      onChange={(event) =>
                        setQuestionDraft(event.target.value)
                      }
                    />
                    <div className="composer-actions">
                      <div className="composer-meta">
                        <span>Transcript-grounded answers only</span>
                      </div>
                      <button
                        className="button button-primary"
                        disabled={asking || !questionDraft.trim()}
                        type="submit"
                      >
                        {asking ? "Answering..." : "Ask"}
                      </button>
                    </div>
                  </form>
                </div>
              ) : null}
            </section>
          </>
        ) : (
          <section className="learning-empty panel">
            <div className="learning-empty-grid">
              <div>
                <p className="muted sidebar-eyebrow">Ready when you are</p>
                <h2>No lesson loaded yet</h2>
                <p className="muted">
                  Paste a YouTube link above to generate study notes, then build
                  a quiz only when you want one.
                </p>
                <p className="muted">
                  Example: {getVideoStub("https://www.youtube.com/watch?v=dQw4w9WgXcQ")}
                </p>
              </div>
              <div className="learning-empty-preview">
                <div className="learning-empty-preview-card">
                  <strong>Notes</strong>
                  <span className="muted">
                    Readable revision sections with clear takeaways
                  </span>
                </div>
                <div className="learning-empty-preview-card">
                  <strong>Quiz</strong>
                  <span className="muted">
                    Interactive question flow with answer feedback
                  </span>
                </div>
                <div className="learning-empty-preview-card">
                  <strong>Ask Questions</strong>
                  <span className="muted">
                    Context‑aware follow‑ups grounded in the transcript
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}
      </section>

      {settingsOpen ? (
        <section className="settings-drawer panel">
          <div className="settings-header">
            <div>
              <p className="muted sidebar-eyebrow">Backend tuning</p>
              <h2>Processing settings</h2>
            </div>
            <button
              className="button button-secondary"
              onClick={() => setSettingsOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>

          <div className="settings-grid">
            <div className="field settings-full">
              <label>Provider</label>
              <div className="settings-static-card">
                <strong>{provider.label}</strong>
                <p className="muted settings-help">
                  {provider.description}
                </p>
              </div>
            </div>

            <div className="field">
              <label htmlFor="model">Model</label>
              <input
                id="model"
                list="model-suggestions"
                value={settingsDraft.model}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    model: event.target.value
                  }))
                }
              />
              <datalist id="model-suggestions">
                {provider.modelSuggestions.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </div>

            <div className="field">
              <label htmlFor="temperature">Temperature</label>
              <input
                id="temperature"
                type="range"
                min="0"
                max="1.2"
                step="0.1"
                value={settingsDraft.temperature}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    temperature: Number(event.target.value)
                  }))
                }
              />
              <span className="muted">
                Current: {settingsDraft.temperature.toFixed(1)}
              </span>
            </div>

            <div className="field">
              <label htmlFor="maxTokens">Max tokens</label>
              <input
                id="maxTokens"
                type="number"
                min={300}
                max={4000}
                value={settingsDraft.maxTokens}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    maxTokens: Number(event.target.value)
                  }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="theme">Theme</label>
              <select
                id="theme"
                value={settingsDraft.theme}
                onChange={(event) =>
                  setSettingsDraft((current) => ({
                    ...current,
                    theme: event.target.value as UserSettings["theme"]
                  }))
                }
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
          </div>

          <div className="settings-actions">
            <p className="muted settings-help">
              These settings affect transcript cleaning, note generation, quiz
              generation, and follow‑up answers.
            </p>
            <button
              className="button button-primary"
              disabled={savingSettings}
              onClick={handleSaveSettings}
              type="button"
            >
              {savingSettings ? "Saving..." : "Save settings"}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
