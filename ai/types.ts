export interface AIChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequestPayload {
  messages: AIChatMessage[];
  generationId?: string;
}

export interface StreamError extends Error {
  status?: number;
  retryAfter?: string | null;
  code?: string;
}

export interface StreamCallbacks {
  onChunk: (text: string, generationId?: string) => void;
  onDone: (fullText: string, generationId?: string) => void;
  onError: (error: StreamError, generationId?: string) => void;
}

export interface AIProvider {
  streamChat(
    messages: AIChatMessage[],
    options?: { signal?: AbortSignal; systemInstruction?: string }
  ): AsyncGenerator<string, void, unknown>;
}
