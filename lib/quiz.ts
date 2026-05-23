import { QuizQuestion } from "@/types";

import { generateChatCompletion } from "@/lib/ai";

const LOCAL_MCQ_COUNT = 7;
const LOCAL_SHORT_ANSWER_COUNT = 3;

function parseField(block: string, field: string) {
  const pattern = new RegExp(`^${field}:\\s*(.+)$`, "im");
  return block.match(pattern)?.[1]?.trim() ?? "";
}

const META_QUESTION_PATTERNS = [
  /\btranscript\b/i,
  /\blesson\b/i,
  /\bvideo\b/i,
  /\bsource\b/i,
  /\btaught here\b/i,
  /\baccording to\b/i,
  /\bthis topic\b/i,
  /\bidea taught\b/i
];

const GENERIC_QUESTION_PATTERNS = [
  /^which statement is correct\??$/i,
  /^which option best describes/i,
  /^which statement about this topic is correct\??$/i,
  /^which option gives the most accurate description\??$/i,
  /^which word correctly completes/i,
  /^explain one important/i
];

const INTRO_SENTENCE_PATTERNS = [
  /\bwelcome\b/i,
  /\bchannel\b/i,
  /\bsubscribe\b/i,
  /\blike and share\b/i,
  /\bthanks for watching\b/i,
  /\bin this video\b/i,
  /\btoday we(?:'| a)?re going to\b/i,
  /\bwe are going to look at\b/i,
  /\bif you are new here\b/i,
  /\bbefore we start\b/i
];

const STOPWORDS = new Set([
  "which",
  "about",
  "their",
  "there",
  "would",
  "could",
  "should",
  "because",
  "during",
  "where",
  "when",
  "with",
  "from",
  "into",
  "that",
  "this",
  "these",
  "those",
  "they",
  "them",
  "then",
  "than",
  "have",
  "will",
  "what",
  "used",
  "using",
  "only",
  "also",
  "your",
  "into",
  "some",
  "more",
  "most",
  "very",
  "been"
]);

function extractStudySentences(source: string) {
  return source
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .flatMap((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 35)
    )
    .filter((value) => !INTRO_SENTENCE_PATTERNS.some((pattern) => pattern.test(value)))
    .filter((value, index, array) => array.indexOf(value) === index);
}

function questionLooksMeta(value: string) {
  return META_QUESTION_PATTERNS.some((pattern) => pattern.test(value));
}

function questionLooksGeneric(value: string) {
  return GENERIC_QUESTION_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

function extractKeywords(value: string) {
  return value
    .toLowerCase()
    .match(/[a-z][a-z0-9-]{3,}/g)?.filter((word) => !STOPWORDS.has(word)) ?? [];
}

function pickKeyword(sentence: string, fallback = "term") {
  const keywords = extractKeywords(sentence)
    .sort((left, right) => right.length - left.length);
  return keywords[0] ?? fallback;
}

function buildQuestionContext(sentences: string[], questionIndex: number, windowSize: number) {
  if (!sentences.length) {
    return "The transcript explains a GCSE topic.";
  }

  const start = (questionIndex * windowSize) % sentences.length;
  const selected: string[] = [];

  for (let offset = 0; offset < windowSize; offset += 1) {
    const sentence = sentences[(start + offset) % sentences.length];
    if (sentence && !selected.includes(sentence)) {
      selected.push(sentence);
    }
  }

  return selected.join(" ");
}

async function extractQuizFacts(input: {
  endpoint: string;
  model: string;
  accessToken?: string;
  quizSource: string;
}) {
  try {
    const raw = await generateChatCompletion({
      endpoint: input.endpoint,
      model: input.model,
      accessToken: input.accessToken,
      temperature: 0,
      maxTokens: 500,
      timeoutMs: 120000,
      messages: [
        {
          role: "system",
          content:
            "Extract concise GCSE quiz facts from a cleaned lesson transcript. Return plain text only with one fact per line."
        },
        {
          role: "user",
          content:
            `From this GCSE lesson transcript, extract 12 short quiz-worthy facts.\n\n` +
            `Rules:\n` +
            `- Use only educational content.\n` +
            `- Ignore greetings, intros, and outro wording.\n` +
            `- Keep facts short and specific.\n` +
            `- One fact per line.\n\n` +
            `Transcript:\n${input.quizSource}`
        }
      ]
    });

    return raw
      .split("\n")
      .map((line: string) => line.replace(/^[\-\d.)\s]+/, "").trim())
      .filter((line: string) => line.length > 20)
      .filter((line: string, index: number, array: string[]) => array.indexOf(line) === index)
      .slice(0, 12);
  } catch {
    return [];
  }
}

function makeSentenceSnippet(value: string, maxLength = 110) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function dedupeMarkSchemePoints(points: Array<{ id: string; label: string; marks: number; acceptedAnswers: string[] }>) {
  const seen = new Set<string>();

  return points.filter((point) => {
    const key = point.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function parseMcqBlock(block: string, index: number): QuizQuestion {
  const question = parseField(block, "QUESTION");
  const options = [
    { id: "option-1", text: parseField(block, "A") },
    { id: "option-2", text: parseField(block, "B") },
    { id: "option-3", text: parseField(block, "C") },
    { id: "option-4", text: parseField(block, "D") }
  ];
  const answerLetter = parseField(block, "ANSWER").toUpperCase();
  const explanation = parseField(block, "EXPLANATION");
  const correctIndex = ["A", "B", "C", "D"].indexOf(answerLetter);

  if (
    !question ||
    options.some((option) => !option.text) ||
    correctIndex < 0 ||
    questionLooksMeta(question) ||
    questionLooksGeneric(question)
  ) {
    throw new Error("The AI provider returned an empty response.");
  }

  return {
    id: `question-${index + 1}`,
    type: "mcq",
    question,
    answer: options[correctIndex].text,
    explanation: explanation || "Review the lesson notes to justify the correct answer.",
    options,
    correctOptionId: options[correctIndex].id,
    markCount: 1
  };
}

function parseShortBlock(block: string, index: number): QuizQuestion {
  const question = parseField(block, "QUESTION");
  const markCount = Math.max(2, Math.min(4, Number(parseField(block, "MARKS")) || 3));
  const answer = parseField(block, "MODEL_ANSWER");
  const explanation = parseField(block, "EXPLANATION");

  if (!question || !answer || questionLooksMeta(question) || questionLooksGeneric(question)) {
    throw new Error("The AI provider returned an empty response.");
  }

  const markScheme = dedupeMarkSchemePoints(Array.from({ length: markCount }, (_, pointIndex) => {
    const label = parseField(block, `POINT_${pointIndex + 1}_LABEL`) || `Point ${pointIndex + 1}`;
    const allow = parseField(block, `POINT_${pointIndex + 1}_ALLOW`);

    return {
      id: `point-${index + 1}-${pointIndex + 1}`,
      label,
      marks: 1,
      acceptedAnswers: allow
        ? allow.split(/\s*\|\s*|\s*\/\s*/).map((item) => item.trim()).filter(Boolean)
        : [label]
    };
  })).slice(0, markCount);

  return {
    id: `question-written-${index + 1}`,
    type: "short-answer",
    question,
    answer,
    explanation: explanation || "Use the mark-scheme points to build a full-mark answer.",
    markCount,
    markScheme
  };
}

function buildFallbackMcq(input: {
  sentences: string[];
  facts: string[];
  index: number;
}): QuizQuestion {
  const fact = input.facts[input.index % input.facts.length] ?? input.sentences[input.index % input.sentences.length] ?? "The lesson explains a key GCSE point.";
  const alt1 = input.facts[(input.index + 1) % input.facts.length] ?? input.sentences[(input.index + 1) % input.sentences.length] ?? "An unrelated statement.";
  const alt2 = input.facts[(input.index + 2) % input.facts.length] ?? input.sentences[(input.index + 2) % input.sentences.length] ?? "Another unrelated statement.";
  const alt3 = input.facts[(input.index + 3) % input.facts.length] ?? input.sentences[(input.index + 3) % input.sentences.length] ?? "Another statement.";
  const base = fact;
  const baseKeyword = pickKeyword(base);
  const distractor1 = pickKeyword(alt1, "glucose");
  const distractor2 = pickKeyword(alt2, "energy");
  const distractor3 = pickKeyword(alt3, "carbon");
  const statement = makeSentenceSnippet(base, 140).replace(
    new RegExp(`\\b${baseKeyword}\\b`, "i"),
    "_____"
  );
  const stemTemplates = [
    `Which term correctly completes the statement about ${baseKeyword}?`,
    `Which option correctly completes the statement about ${baseKeyword}?`,
    `Which key term completes this GCSE statement?`,
    `Which word completes the statement correctly?`
  ];
  const options = [
    { id: "option-1", text: baseKeyword },
    { id: "option-2", text: distractor1 },
    { id: "option-3", text: distractor2 },
    { id: "option-4", text: distractor3 }
  ];
  if (new Set(options.map((option) => option.text.toLowerCase())).size < 4) {
    options[3] = { id: "option-4", text: "None of the above" };
  }
  const correctOptionId = "option-1";

  return {
    id: `question-${input.index + 1}`,
    type: "mcq",
    question: `${stemTemplates[input.index % stemTemplates.length]} "${statement}"`,
    answer: options.find((option) => option.id === correctOptionId)?.text ?? baseKeyword,
    explanation: "This fallback question was derived directly from the lesson content.",
    markCount: 1,
    correctOptionId,
    options
  };
}

function buildFallbackShort(input: {
  sentences: string[];
  facts: string[];
  index: number;
}): QuizQuestion {
  const base = input.facts[(input.index * 2) % input.facts.length] ?? input.sentences[(input.index * 2) % input.sentences.length] ?? "The lesson explains one key GCSE process.";
  const support = input.facts[(input.index * 2 + 1) % input.facts.length] ?? input.sentences[(input.index * 2 + 1) % input.sentences.length] ?? "It also gives one supporting detail.";
  const keyword = pickKeyword(base, "the process");
  const shortStems = [
    `Describe ${keyword}.`,
    `Explain ${keyword}.`,
    `State and explain one key point about ${keyword}.`,
    `Give one reason linked to ${keyword} and explain it.`
  ];

  return {
    id: `question-written-${input.index + 1}`,
    type: "short-answer",
    question: shortStems[input.index % shortStems.length],
    answer: `${makeSentenceSnippet(base, 180)} ${makeSentenceSnippet(support, 140)}`,
    explanation: "This fallback question was built directly from the lesson content.",
    markCount: 2,
    markScheme: [
      {
        id: `point-${input.index + 1}-1`,
        label: "Relevant taught point",
        marks: 1,
        acceptedAnswers: [makeSentenceSnippet(base, 140)]
      },
      {
        id: `point-${input.index + 1}-2`,
        label: "Supporting transcript detail",
        marks: 1,
        acceptedAnswers: [makeSentenceSnippet(support, 140)]
      }
    ]
  };
}

async function generatePlainTextQuestion(input: {
  endpoint: string;
  model: string;
  accessToken?: string;
  type: "mcq" | "short-answer";
  questionNumber: number;
  totalMcqs: number;
  totalShorts: number;
  quizSource: string;
  questionContext: string;
  priorQuestions?: string[];
}) {
  const previousQuestionContext = input.priorQuestions?.length
    ? `\nPreviously generated questions to avoid repeating:\n${input.priorQuestions.map((question, index) => `${index + 1}. ${question}`).join("\n")}\n`
    : "";

  const basePrompt =
    input.type === "mcq"
      ? `Create GCSE multiple-choice question ${input.questionNumber + 1} of ${input.totalMcqs} using only the transcript below.\n\n` +
        `Rules:\n` +
        `- Use only transcript content.\n` +
        `- Stay strictly at GCSE level.\n` +
        `- Avoid A-level, outside-topic, or extra knowledge.\n` +
        `- Write the question like a normal GCSE revision or exam-style multiple-choice question.\n` +
        `- Do not write stems like "According to the lesson", "Which statement best matches the transcript", or anything mentioning the lesson/video/source.\n` +
        `- Do not write generic stems like "Which statement is correct?" or "Which option best describes the idea taught here?".\n` +
        `- Use subject-specific stems such as "What is...", "Which process...", "Which substance...", "Why does...", "How does...", or "Which statement about X is correct?" where X is the real topic term.\n` +
        `- Use 4 options.\n` +
        `- Avoid "All of the above" and "None of the above" unless there is genuinely no better fourth option.\n` +
        `- If you use a filler option, use only one of them, not both.\n` +
        `- Only make a filler option correct when it genuinely fits the content.\n` +
        `- Make distractors plausible.\n\n` +
        `${previousQuestionContext}` +
        `Return exactly in this format:\n` +
        `QUESTION: ...\n` +
        `A: ...\n` +
        `B: ...\n` +
        `C: ...\n` +
        `D: ...\n` +
        `ANSWER: A or B or C or D\n` +
        `EXPLANATION: ...\n\n` +
        `Focus transcript excerpt:\n${input.questionContext}\n\n` +
        `Full transcript backup:\n${input.quizSource}`
      : `Create GCSE written exam question ${input.questionNumber + 1} of ${input.totalShorts} using only the transcript below.\n\n` +
        `Rules:\n` +
        `- Use only transcript content.\n` +
        `- Stay strictly at GCSE level.\n` +
        `- Avoid A-level, outside-topic, or extra knowledge.\n` +
        `- Make it a proper GCSE exam-style prompt like a past-paper question.\n` +
        `- Use realistic GCSE mark counts such as 2, 3, or 4.\n` +
        `- Do not write generic prompts like "Explain one important point". Use the real topic term in the question.\n` +
        `- The mark scheme must be grounded in the transcript.\n\n` +
        `${previousQuestionContext}` +
        `Return exactly in this format:\n` +
        `QUESTION: ...\n` +
        `MARKS: 2 or 3 or 4\n` +
        `MODEL_ANSWER: ...\n` +
        `EXPLANATION: ...\n` +
        `POINT_1_LABEL: ...\n` +
        `POINT_1_ALLOW: ... | ...\n` +
        `POINT_2_LABEL: ...\n` +
        `POINT_2_ALLOW: ... | ...\n` +
        `POINT_3_LABEL: ...\n` +
        `POINT_3_ALLOW: ... | ...\n` +
        `POINT_4_LABEL: ...\n` +
        `POINT_4_ALLOW: ... | ...\n\n` +
        `If fewer than 4 marks are used, only include the needed POINT lines.\n\n` +
        `Focus transcript excerpt:\n${input.questionContext}\n\n` +
        `Full transcript backup:\n${input.quizSource}`;

  return generateChatCompletion({
    endpoint: input.endpoint,
    model: input.model,
    accessToken: input.accessToken,
    temperature: 0.15,
    maxTokens: input.type === "mcq" ? 260 : 420,
    timeoutMs: 180000,
    messages: [
      {
        role: "system",
        content:
          "You are a GCSE revision assistant. Respond in plain text only. Do not use JSON, markdown tables, or code fences."
      },
      {
        role: "user",
        content: basePrompt
      }
    ]
  });
}

async function generateMcqQuiz(input: {
  endpoint: string;
  model: string;
  accessToken?: string;
  quizSource: string;
  sentences: string[];
  facts: string[];
  onProgress?: (completed: number, total: number) => void;
}) {
  const questions: QuizQuestion[] = [];

  for (let index = 0; index < LOCAL_MCQ_COUNT; index += 1) {
    let question: QuizQuestion | null = null;
    const priorQuestions = questions.map((item) => item.question);
    const questionContext = buildQuestionContext(input.sentences, index, 3);

    for (let attempt = 0; attempt < 5 && !question; attempt += 1) {
      try {
        const raw = await generatePlainTextQuestion({
          endpoint: input.endpoint,
          model: input.model,
          accessToken: input.accessToken,
          type: "mcq",
          questionNumber: index,
          totalMcqs: LOCAL_MCQ_COUNT,
          totalShorts: LOCAL_SHORT_ANSWER_COUNT,
          quizSource: input.quizSource,
          questionContext,
          priorQuestions
        });
        question = parseMcqBlock(raw, index);
      } catch {
        if (attempt === 4) {
          question = buildFallbackMcq({
            sentences: input.sentences,
            facts: input.facts,
            index
          });
        }
      }
    }

    if (question) {
      questions.push(question);
    }

    input.onProgress?.(index + 1, LOCAL_MCQ_COUNT);
  }

  return questions;
}

async function generateShortAnswerQuiz(input: {
  endpoint: string;
  model: string;
  accessToken?: string;
  quizSource: string;
  sentences: string[];
  facts: string[];
  onProgress?: (completed: number, total: number) => void;
}) {
  const questions: QuizQuestion[] = [];

  for (let index = 0; index < LOCAL_SHORT_ANSWER_COUNT; index += 1) {
    let question: QuizQuestion | null = null;
    const priorQuestions = questions.map((item) => item.question);
    const questionContext = buildQuestionContext(input.sentences, index + LOCAL_MCQ_COUNT, 4);

    for (let attempt = 0; attempt < 5 && !question; attempt += 1) {
      try {
        const raw = await generatePlainTextQuestion({
          endpoint: input.endpoint,
          model: input.model,
          accessToken: input.accessToken,
          type: "short-answer",
          questionNumber: index,
          totalMcqs: LOCAL_MCQ_COUNT,
          totalShorts: LOCAL_SHORT_ANSWER_COUNT,
          quizSource: input.quizSource,
          questionContext,
          priorQuestions
        });
        question = parseShortBlock(raw, index);
      } catch {
        if (attempt === 4) {
          question = buildFallbackShort({
            sentences: input.sentences,
            facts: input.facts,
            index
          });
        }
      }
    }

    if (question) {
      questions.push(question);
    }

    input.onProgress?.(index + 1, LOCAL_SHORT_ANSWER_COUNT);
  }

  return questions;
}

function interleaveQuizQuestions(mcqs: QuizQuestion[], shorts: QuizQuestion[]) {
  const combined = [
    mcqs[0],
    mcqs[1],
    shorts[0],
    mcqs[2],
    mcqs[3],
    shorts[1],
    mcqs[4],
    mcqs[5],
    shorts[2],
    mcqs[6]
  ].filter(Boolean);

  return combined.map((question, index) => ({
    ...question,
    id: `question-${index + 1}`
  }));
}

export async function generateLessonQuiz(input: {
  endpoint: string;
  model: string;
  accessToken?: string;
  quizSource: string;
  onProgress?: (detail: string, progress: number) => void;
}): Promise<QuizQuestion[]> {
  const sentences = extractStudySentences(input.quizSource);
  const facts = await extractQuizFacts({
    endpoint: input.endpoint,
    model: input.model,
    accessToken: input.accessToken,
    quizSource: input.quizSource
  });

  input.onProgress?.("Generating multiple-choice questions", 22);
  const mcqs = await generateMcqQuiz({
    endpoint: input.endpoint,
    model: input.model,
    accessToken: input.accessToken,
    quizSource: input.quizSource,
    sentences,
    facts,
    onProgress: (completed, total) =>
      input.onProgress?.(
        `Generating multiple-choice questions (${completed}/${total})`,
        22 + Math.round((completed / total) * 38)
      )
  });

  input.onProgress?.("Generating written exam questions", 64);
  const shorts = await generateShortAnswerQuiz({
    endpoint: input.endpoint,
    model: input.model,
    accessToken: input.accessToken,
    quizSource: input.quizSource,
    sentences,
    facts,
    onProgress: (completed, total) =>
      input.onProgress?.(
        `Generating written exam questions (${completed}/${total})`,
        64 + Math.round((completed / total) * 24)
      )
  });

  input.onProgress?.("Formatting the quiz", 92);

  const quiz = interleaveQuizQuestions(mcqs, shorts);
  if (quiz.length !== LOCAL_MCQ_COUNT + LOCAL_SHORT_ANSWER_COUNT) {
    throw new Error("Unable to generate the full quiz right now.");
  }

  return quiz;
}
