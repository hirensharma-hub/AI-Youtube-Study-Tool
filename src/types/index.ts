export type AppTheme = "system" | "light" | "dark";
export type ProviderId = "ollama";

export interface UserSettings {
  theme: AppTheme;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface ViewerUser {
  id: string;
  email: string;
  name: string;
}

export interface ProviderCatalogItem {
  id: "ollama";
  label: string;
  description: string;
  defaultModel: string;
  modelSuggestions: string[];
}

export interface QuizOption {
  id: string;
  text: string;
}

export interface MarkSchemePoint {
  id: string;
  label: string;
  marks: number;
  acceptedAnswers: string[];
}

export interface QuizQuestion {
  id: string;
  type: "mcq" | "short-answer";
  question: string;
  answer: string;
  explanation: string;
  options?: QuizOption[];
  correctOptionId?: string;
  markCount: number;
  markScheme?: MarkSchemePoint[];
}

export interface ProcessedVideo {
  id: string;
  videoId: string;
  videoUrl: string;
  title: string;
  rawTranscript: string;
  cleanedTranscript: string;
  notes: string;
  quiz: QuizQuestion[];
  processingVersion: number;
  transcriptLanguage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionAnswerMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ShortAnswerGrade {
  awardedMarks: number;
  totalMarks: number;
  feedback: string;
  matchedPoints: Array<{
    pointId: string;
    label: string;
    awarded: boolean;
    reason: string;
    marks: number;
  }>;
}
