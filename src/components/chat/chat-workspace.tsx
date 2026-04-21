"use client";

import { useRouter } from "next/navigation";
import { Fragment, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";

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

type ActiveTab = "notes" | "quiz" | "questions";
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

const fallbackSettings: UserSettings = {
  theme: "system",
  model: providerCatalog.ollama.defaultModel,
  temperature: 0.4,
  maxTokens: 1200
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
    if (!part) {
      return null;
    }

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
        <HeadingTag key={`heading-${index}`} className={`learning-heading learning-heading-${level}`}>
          {renderInlineText(headingMatch[2].trim(), `heading-${index}`)}
        </HeadingTag>
      );
      index += 1;
      continue;
    }

    if (/^\*\*.+\*\*$/.test(line) && !line.includes(":")) {
      const title = line.replace(/^\*\*|\*\*$/g, "").trim();
      blocks.push(
        <h2 key={`title-${index}`} className="learning-heading learning-heading-feature">
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
                    <th key={`table-head-${cellIndex}`}>{renderInlineText(cell, `table-head-${cellIndex}`)}</th>
                  ))}
                </tr>
              </thead>
              {body.length ? (
                <tbody>
                  {body.map((row, rowIndex) => (
                    <tr key={`table-row-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`table-cell-${rowIndex}-${cellIndex}`}>
                          {renderInlineText(cell, `table-cell-${rowIndex}-${cellIndex}`)}
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
            <li key={`list-item-${itemIndex}`}>{renderInlineText(item, `list-item-${itemIndex}`)}</li>
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
        <ol key={`ordered-list-${index}`} className="learning-list learning-list-ordered">
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
      if (!nextLine || isSpecialBlockStart(nextLine)) {
        break;
      }

      paragraphLines.push(nextLine);
      index += 1;
    }

    blocks.push(
      <p key={`paragraph-${index}`} className="learning-paragraph">
        {renderInlineText(paragraphLines.join(" "), `paragraph-${index}`)}
      </p>
    );
  }

  return blocks;
}

async function getJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed." }));
    throw new Error(payload.error || "Request failed.");
  }

  const text = await response.text();
  if (!text.trim()) {
    throw new Error("The server returned an empty response. Please try again.");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("The server returned invalid data. Please try again.");
  }
}

export function LearningWorkspace({ initialUser, initialSettings }: LearningWorkspaceProps) {
  const router = useRouter();
  const qaEndRef = useRef<HTMLDivElement | null>(null);
  const [user] = useState(initialUser);
  const [provider] = useState<ProviderCatalogItem>(providerCatalog.ollama);
  const [settings, setSettings] = useState<UserSettings>(initialSettings ?? fallbackSettings);
  const [settingsDraft, setSettingsDraft] = useState<UserSettings>(initialSettings ?? fallbackSettings);
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
  const [gradingQuiz, setGradingQuiz] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState("");

  const qaMessages = useMemo(() => {
    if (!activeVideo) {
      return [];
    }

    return qaCache[activeVideo.videoId] ?? [];
  }, [activeVideo, qaCache]);

  const activeQuizIndex = activeVideo ? Math.min(quizProgress[activeVideo.videoId] ?? 0, Math.max(activeVideo.quiz.length - 1, 0)) : 0;
  const activeQuizQuestion = activeVideo ? activeVideo.quiz[activeQuizIndex] : null;
  const activeQuizSelection =
    activeVideo && activeQuizQuestion
      ? quizSelections[activeVideo.videoId]?.[activeQuizQuestion.id] ?? ""
      : "";
  const activeQuizShortAnswer =
    activeVideo && activeQuizQuestion
      ? quizShortAnswers[activeVideo.videoId]?.[activeQuizQuestion.id] ?? ""
      : "";
  const activeQuizIsRevealed =
    activeVideo && activeQuizQuestion
      ? Boolean(quizRevealed[activeVideo.videoId]?.[activeQuizQuestion.id])
      : false;
  const activeQuizGrade =
    activeVideo && activeQuizQuestion
      ? quizGrades[activeVideo.videoId]?.[activeQuizQuestion.id]
      : undefined;
  const answeredQuizCount = activeVideo ? Object.keys(quizRevealed[activeVideo.videoId] ?? {}).length : 0;
  const quizCorrectCount = activeVideo
    ? activeVideo.quiz.filter((question) => {
        const selection = quizSelections[activeVideo.videoId]?.[question.id];
        return selection && selection === question.correctOptionId;
      }).length
    : 0;

  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    qaEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [qaMessages, asking]);

  async function handleSaveSettings() {
    setSavingSettings(true);
    setError("");

    try {
      const data = await getJson<{ settings: UserSettings }>("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(settingsDraft)
      });

      setSettings(data.settings);
      setSettingsDraft(data.settings);
      applyTheme(data.settings.theme);
      setSettingsOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save your settings.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleThemeToggle() {
    const sequence: UserSettings["theme"][] = ["system", "light", "dark"];
    const currentIndex = sequence.indexOf(settings.theme);
    const nextTheme = sequence[(currentIndex + 1) % sequence.length];

    setSettings((current) => ({ ...current, theme: nextTheme }));
    setSettingsDraft((current) => ({ ...current, theme: nextTheme }));
    applyTheme(nextTheme);

    try {
      await getJson("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ theme: nextTheme })
      });
    } catch {
      return;
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function handleProcessVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedUrl = videoUrlInput.trim();
    if (!trimmedUrl || processing) {
      return;
    }

    if (videoCache[trimmedUrl]) {
      setActiveVideo(videoCache[trimmedUrl]);
      setActiveTab("notes");
      setError("");
      return;
    }

    setProcessing(true);
    setProcessingState({
      taskId: "",
      stage: "queued",
      detail: "Preparing the cloud AI pipeline",
      progress: 2
    });
    setError("");

    try {
      const data = await getJson<{ video?: ProcessedVideo; taskId?: string; done?: boolean }>("/api/process-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          videoUrl: trimmedUrl
        })
      });

      if (data.done && data.video) {
        const immediateVideo = data.video;

        setActiveVideo(immediateVideo);
        setVideoCache((current) => ({
          ...current,
          [trimmedUrl]: immediateVideo,
          [immediateVideo.videoId]: immediateVideo
        }));
        setQaCache((current) => ({
          ...current,
          [immediateVideo.videoId]: current[immediateVideo.videoId] ?? []
        }));
        setQuizSelections((current) => ({
          ...current,
          [immediateVideo.videoId]: current[immediateVideo.videoId] ?? {}
        }));
        setQuizRevealed((current) => ({
          ...current,
          [immediateVideo.videoId]: current[immediateVideo.videoId] ?? {}
        }));
        setQuizProgress((current) => ({
          ...current,
          [immediateVideo.videoId]: 0
        }));
        setQuizShortAnswers((current) => ({
          ...current,
          [immediateVideo.videoId]: current[immediateVideo.videoId] ?? {}
        }));
        setQuizGrades((current) => ({
          ...current,
          [immediateVideo.videoId]: current[immediateVideo.videoId] ?? {}
        }));
        setActiveTab("notes");
        setProcessingState(null);
        return;
      }

      if (!data.taskId) {
        throw new Error("The server did not return a processing task.");
      }

      setProcessingState({
        taskId: data.taskId,
        stage: "queued",
        detail: "Preparing the cloud AI pipeline",
        progress: 2
      });

      let completedVideo: ProcessedVideo | null = null;

      const startedAt = Date.now();
      let missingTaskCount = 0;

      while (!completedVideo) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        let status:
          | {
              status: "running" | "completed" | "failed";
              stage: string;
              detail: string;
              progress: number;
              error?: string;
              video?: ProcessedVideo;
            }
          | null = null;

        try {
          status = await getJson<{
            status: "running" | "completed" | "failed";
            stage: string;
            detail: string;
            progress: number;
            error?: string;
            video?: ProcessedVideo;
          }>(`/api/process-video?taskId=${data.taskId}`);
          missingTaskCount = 0;
        } catch (pollError) {
          const message = pollError instanceof Error ? pollError.message : "";
          if (message.includes("could not be found") && missingTaskCount < 2) {
            missingTaskCount += 1;
            continue;
          }

          throw pollError;
        }

        if (!status) {
          continue;
        }

        setProcessingState({
          taskId: data.taskId,
          stage: status.stage,
          detail: status.detail,
          progress: status.progress
        });

        if (status.status === "failed") {
          throw new Error(status.error || "Unable to process that video.");
        }

        if (status.status === "completed" && status.video) {
          completedVideo = status.video;
        }

        if (Date.now() - startedAt > 15 * 60 * 1000) {
          throw new Error("Cloud processing is taking too long. Try a shorter video or switch to a lighter Ollama Cloud model.");
        }
      }

      setActiveVideo(completedVideo);
      setVideoCache((current) => ({
        ...current,
        [trimmedUrl]: completedVideo,
        [completedVideo.videoId]: completedVideo
      }));
      setQaCache((current) => ({
        ...current,
        [completedVideo.videoId]: current[completedVideo.videoId] ?? []
      }));
      setQuizSelections((current) => ({
        ...current,
        [completedVideo.videoId]: current[completedVideo.videoId] ?? {}
      }));
      setQuizRevealed((current) => ({
        ...current,
        [completedVideo.videoId]: current[completedVideo.videoId] ?? {}
      }));
      setQuizProgress((current) => ({
        ...current,
        [completedVideo.videoId]: 0
      }));
      setQuizShortAnswers((current) => ({
        ...current,
        [completedVideo.videoId]: current[completedVideo.videoId] ?? {}
      }));
      setQuizGrades((current) => ({
        ...current,
        [completedVideo.videoId]: current[completedVideo.videoId] ?? {}
      }));
      setActiveTab("notes");
      setProcessingState(null);
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : "Unable to process that video.");
      setProcessingState(null);
    } finally {
      setProcessing(false);
    }
  }

  function handleSelectQuizOption(questionId: string, optionId: string) {
    if (!activeVideo || activeQuizIsRevealed) {
      return;
    }

    setQuizSelections((current) => ({
      ...current,
      [activeVideo.videoId]: {
        ...(current[activeVideo.videoId] ?? {}),
        [questionId]: optionId
      }
    }));
  }

  async function handleSubmitQuizAnswer() {
    if (!activeVideo || !activeQuizQuestion) {
      return;
    }

    if (activeQuizQuestion.type === "mcq" && !activeQuizSelection) {
      return;
    }

    if (activeQuizQuestion.type === "short-answer" && !activeQuizShortAnswer.trim()) {
      return;
    }

    if (activeQuizQuestion.type === "short-answer") {
      setGradingQuiz(true);
      setError("");

      try {
        const data = await getJson<{ grade: ShortAnswerGrade }>("/api/grade-question", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            videoId: activeVideo.videoId,
            questionId: activeQuizQuestion.id,
            studentAnswer: activeQuizShortAnswer
          })
        });

        setQuizGrades((current) => ({
          ...current,
          [activeVideo.videoId]: {
            ...(current[activeVideo.videoId] ?? {}),
            [activeQuizQuestion.id]: data.grade
          }
        }));
      } catch (gradeError) {
        setError(gradeError instanceof Error ? gradeError.message : "Unable to grade that answer.");
        setGradingQuiz(false);
        return;
      } finally {
        setGradingQuiz(false);
      }
    }

    setQuizRevealed((current) => ({
      ...current,
      [activeVideo.videoId]: {
        ...(current[activeVideo.videoId] ?? {}),
        [activeQuizQuestion.id]: true
      }
    }));
  }

  function handleShortAnswerChange(questionId: string, value: string) {
    if (!activeVideo || activeQuizIsRevealed) {
      return;
    }

    setQuizShortAnswers((current) => ({
      ...current,
      [activeVideo.videoId]: {
        ...(current[activeVideo.videoId] ?? {}),
        [questionId]: value
      }
    }));
  }

  function handleNextQuizQuestion() {
    if (!activeVideo) {
      return;
    }

    setQuizProgress((current) => ({
      ...current,
      [activeVideo.videoId]: Math.min((current[activeVideo.videoId] ?? 0) + 1, activeVideo.quiz.length - 1)
    }));
  }

  function handleRestartQuiz() {
    if (!activeVideo) {
      return;
    }

    setQuizSelections((current) => ({
      ...current,
      [activeVideo.videoId]: {}
    }));
    setQuizRevealed((current) => ({
      ...current,
      [activeVideo.videoId]: {}
    }));
    setQuizProgress((current) => ({
      ...current,
      [activeVideo.videoId]: 0
    }));
    setQuizShortAnswers((current) => ({
      ...current,
      [activeVideo.videoId]: {}
    }));
    setQuizGrades((current) => ({
      ...current,
      [activeVideo.videoId]: {}
    }));
  }

  async function handleAskQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = questionDraft.trim();
    if (!activeVideo || !question || asking) {
      return;
    }

    const optimisticUserMessage: QuestionAnswerMessage = {
      id: `qa-user-${Date.now()}`,
      role: "user",
      content: question,
      createdAt: new Date().toISOString()
    };

    setQaCache((current) => ({
      ...current,
      [activeVideo.videoId]: [...(current[activeVideo.videoId] ?? []), optimisticUserMessage]
    }));
    setQuestionDraft("");
    setAsking(true);
    setError("");

    try {
      const data = await getJson<{ answer: string }>("/api/ask-question", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          videoId: activeVideo.videoId,
          question
        })
      });

      const assistantMessage: QuestionAnswerMessage = {
        id: `qa-assistant-${Date.now()}`,
        role: "assistant",
        content: data.answer,
        createdAt: new Date().toISOString()
      };

      setQaCache((current) => ({
        ...current,
        [activeVideo.videoId]: [...(current[activeVideo.videoId] ?? []), assistantMessage]
      }));
    } catch (askError) {
      setQaCache((current) => ({
        ...current,
        [activeVideo.videoId]: (current[activeVideo.videoId] ?? []).filter(
          (message) => message.id !== optimisticUserMessage.id
        )
      }));
      setQuestionDraft(question);
      setError(askError instanceof Error ? askError.message : "Unable to answer that question.");
    } finally {
      setAsking(false);
    }
  }

  async function handleGenerateQuiz() {
    if (!activeVideo || generatingQuiz || activeVideo.quiz.length > 0) {
      return;
    }

    setGeneratingQuiz(true);
    setError("");

    try {
      const data = await getJson<{ video: ProcessedVideo }>("/api/generate-quiz", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          videoId: activeVideo.videoId
        })
      });

      setActiveVideo(data.video);
      setVideoCache((current) => ({
        ...current,
        [data.video.videoId]: data.video,
        [data.video.videoUrl]: data.video
      }));
      setQuizProgress((current) => ({
        ...current,
        [data.video.videoId]: 0
      }));
      setQuizSelections((current) => ({
        ...current,
        [data.video.videoId]: current[data.video.videoId] ?? {}
      }));
      setQuizRevealed((current) => ({
        ...current,
        [data.video.videoId]: current[data.video.videoId] ?? {}
      }));
      setQuizShortAnswers((current) => ({
        ...current,
        [data.video.videoId]: current[data.video.videoId] ?? {}
      }));
      setQuizGrades((current) => ({
        ...current,
        [data.video.videoId]: current[data.video.videoId] ?? {}
      }));
    } catch (quizError) {
      setError(quizError instanceof Error ? quizError.message : "Unable to generate the quiz right now.");
    } finally {
      setGeneratingQuiz(false);
    }
  }

  return (
    <main className="learning-app">
      <section className="learning-shell">
        <header className="panel learning-topbar">
          <div className="learning-brand-lockup">
            <div className="learning-brand-mark">Y</div>
            <div>
              <p className="muted sidebar-eyebrow">LessonLift workspace</p>
              <h1>Welcome back, {user.name}</h1>
            </div>
          </div>
          <div className="learning-header-actions">
            <button className="button button-secondary" onClick={handleThemeToggle} type="button">
              Theme: {settings.theme}
            </button>
            <button className="button button-secondary" onClick={() => setSettingsOpen(true)} type="button">
              Settings
            </button>
            <button className="button button-secondary" onClick={handleLogout} type="button">
              Log out
            </button>
          </div>
        </header>

        <section className="hero-card learning-hero">
          <div className="learning-hero-copy">
            <p className="learning-kicker">YouTube to study pack</p>
            <h2>Build revision notes, quizzes, and grounded answers from one lesson.</h2>
            <p className="muted learning-subtitle">
              Drop in a YouTube link and the workspace turns it into a proper learning set you can read, test, and ask
              from.
            </p>

            <form className="learning-url-form" onSubmit={handleProcessVideo}>
              <input
                className="learning-url-input"
                placeholder="https://www.youtube.com/watch?v=..."
                value={videoUrlInput}
                onChange={(event) => setVideoUrlInput(event.target.value)}
              />
              <button className="button button-primary learning-generate-button" disabled={processing || !videoUrlInput.trim()} type="submit">
                {processing ? "Processing video..." : "Generate study pack"}
              </button>
            </form>

            <div className="learning-meta-row">
              <span className="learning-pill">{provider.label}</span>
              <span className="learning-pill">{settings.model}</span>
              <span className="learning-pill">Notes + Quiz + Q&A</span>
            </div>
          </div>

          <div className="learning-hero-aside panel">
            <div className="learning-overview-card">
              <p className="muted sidebar-eyebrow">Workspace snapshot</p>
              <div className="learning-overview-grid">
                <div className="learning-overview-metric">
                  <strong>{activeVideo ? 1 : 0}</strong>
                  <span className="muted">Active lesson</span>
                </div>
                <div className="learning-overview-metric">
                  <strong>{activeVideo?.quiz.length ?? 0}</strong>
                  <span className="muted">Quiz items</span>
                </div>
                <div className="learning-overview-metric">
                  <strong>{qaMessages.length}</strong>
                  <span className="muted">Follow-up answers</span>
                </div>
              </div>
            </div>
            <div className="learning-tip-card">
              <p className="muted sidebar-eyebrow">Best results</p>
              <ul className="learning-mini-list">
                <li>Use lesson videos with clear spoken explanations</li>
                <li>Regenerate after changing the model in settings</li>
                <li>Ask follow-ups after reading the note summary first</li>
              </ul>
            </div>
          </div>
        </section>

        {error ? <p className="error-text workspace-error">{error}</p> : null}

        {processing ? (
          <section className="learning-status panel">
            <div className="learning-status-badge">Processing video</div>
            <div>
              <h2>Building your study pack</h2>
              <p className="muted">
                {processingState?.detail ?? "Extracting the transcript, preparing the lesson, generating notes, and building the quiz."}
              </p>
              <div className="learning-progress-track" aria-hidden="true">
                <div
                  className="learning-progress-fill"
                  style={{ width: `${Math.max(4, processingState?.progress ?? 6)}%` }}
                />
              </div>
            </div>
            <div className="learning-status-steps">
              <span className={processingState?.stage === "transcript" ? "is-active" : ""}>Transcript</span>
              <span className={processingState?.stage === "cleaning" || processingState?.stage === "notes" ? "is-active" : ""}>Notes</span>
              <span className={processingState?.stage === "mcq" || processingState?.stage === "written" ? "is-active" : ""}>Quiz</span>
              <span className={processingState?.stage === "saving" || processingState?.stage === "completed" ? "is-active" : ""}>Finalizing</span>
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
                  {activeVideo.quiz.length ? `Quiz progress: ${answeredQuizCount}/${activeVideo.quiz.length}` : "Quiz unavailable"}
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
                  : activeTab === "quiz"
                    ? activeVideo.quiz.length
                      ? "Answer each question before the explanation appears"
                      : "Generate or regenerate the quiz for this lesson"
                    : "Ask only from the lesson transcript"}
              </div>
            </nav>

            <section className="learning-content panel">
              {activeTab === "notes" ? (
                <article className="learning-rich-text">{renderRichStudyText(activeVideo.notes)}</article>
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
                        <button className="button button-primary" disabled={generatingQuiz} onClick={handleGenerateQuiz} type="button">
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
                            onChange={(event) => handleShortAnswerChange(activeQuizQuestion.id, event.target.value)}
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
                            {activeQuizQuestion.type === "short-answer" && gradingQuiz ? "Marking..." : "Check answer"}
                          </button>
                        ) : (
                          <>
                            <div className="quiz-feedback">
                              {activeQuizQuestion.type === "mcq" ? (
                                <p className={activeQuizSelection === activeQuizQuestion.correctOptionId ? "quiz-feedback-correct" : "quiz-feedback-wrong"}>
                                  {activeQuizSelection === activeQuizQuestion.correctOptionId
                                    ? "Correct answer."
                                    : `Incorrect. The correct answer is ${activeQuizQuestion.answer}.`}
                                </p>
                              ) : (
                                <>
                                  <p className="quiz-feedback-neutral">
                                    Awarded {activeQuizGrade?.awardedMarks ?? 0} / {activeQuizQuestion.markCount} marks
                                  </p>
                                  <p>{activeQuizGrade?.feedback ?? "No detailed feedback returned yet."}</p>
                                  {activeQuizQuestion.markScheme?.length ? (
                                    <div className="quiz-markscheme">
                                      <p className="quiz-feedback-neutral">Mark scheme breakdown</p>
                                      <div className="quiz-markscheme-points">
                                        {activeQuizQuestion.markScheme.map((point) => {
                                          const gradedPoint = activeQuizGrade?.matchedPoints.find((item) => item.pointId === point.id);

                                          return (
                                            <article
                                              key={point.id}
                                              className={`quiz-markscheme-point ${
                                                gradedPoint?.awarded ? "is-awarded" : "is-missed"
                                              }`}
                                            >
                                              <div className="quiz-markscheme-point-header">
                                                <strong>
                                                  {point.marks} {point.marks === 1 ? "mark" : "marks"} for {point.label}
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
                              <button className="button button-primary" onClick={handleNextQuizQuestion} type="button">
                                Next question
                              </button>
                            ) : (
                              <button className="button button-secondary" onClick={handleRestartQuiz} type="button">
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
                          className={`message-row ${message.role === "user" ? "is-user" : "is-assistant"}`}
                        >
                          <div className="message-bubble">
                            <div className="message-meta">
                              <strong>{message.role === "user" ? "You" : "Lesson AI"}</strong>
                            </div>
                            <p>{message.content}</p>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="empty-state">
                        <p>Ask a question about this video.</p>
                        <p className="muted">Answers will use only the processed transcript and no outside knowledge.</p>
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
                      onChange={(event) => setQuestionDraft(event.target.value)}
                    />
                    <div className="composer-actions">
                      <div className="composer-meta">
                        <span>Transcript-grounded answers only</span>
                      </div>
                      <button className="button button-primary" disabled={asking || !questionDraft.trim()} type="submit">
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
                  Paste a YouTube link above to generate study notes, then build a quiz only when you want one.
                </p>
                <p className="muted">Example: {getVideoStub("https://www.youtube.com/watch?v=dQw4w9WgXcQ")}</p>
              </div>
              <div className="learning-empty-preview">
                <div className="learning-empty-preview-card">
                  <strong>Notes</strong>
                  <span className="muted">Readable revision sections with clear takeaways</span>
                </div>
                <div className="learning-empty-preview-card">
                  <strong>Quiz</strong>
                  <span className="muted">Interactive question flow with answer feedback</span>
                </div>
                <div className="learning-empty-preview-card">
                  <strong>Ask Questions</strong>
                  <span className="muted">Context-aware follow-ups grounded in the transcript</span>
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
            <button className="button button-secondary" onClick={() => setSettingsOpen(false)} type="button">
              Close
            </button>
          </div>

          <div className="settings-grid">
            <div className="field settings-full">
              <label>Provider</label>
              <div className="settings-static-card">
                <strong>{provider.label}</strong>
                <p className="muted settings-help">{provider.description}</p>
              </div>
            </div>

            <div className="field">
              <label htmlFor="model">Model</label>
              <input
                id="model"
                list="model-suggestions"
                value={settingsDraft.model}
                onChange={(event) => setSettingsDraft((current) => ({ ...current, model: event.target.value }))}
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
              <span className="muted">Current: {settingsDraft.temperature.toFixed(1)}</span>
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
              These settings affect transcript cleaning, note generation, quiz generation, and follow-up answers.
            </p>
            <button className="button button-primary" disabled={savingSettings} onClick={handleSaveSettings} type="button">
              {savingSettings ? "Saving..." : "Save settings"}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
