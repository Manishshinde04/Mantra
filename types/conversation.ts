export type MessageRole = "user" | "assistant";

export interface TranscriptMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  isPartial?: boolean;
  interrupted?: boolean;
}

export interface ConversationSession {
  id: string;
  startedAt: number;
  messages: TranscriptMessage[];
}
