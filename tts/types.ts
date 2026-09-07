export interface TTSConfig {
  apiKey?: string;
  endpoint: string;
  modelId: string;
  speaker: string;
  lang: string;
  audioFormat: "mp3" | "wav";
  speedAlpha?: number;
}

export interface TTSRequest {
  text: string;
  speaker?: string;
  modelId?: string;
  lang?: string;
  audioFormat?: "mp3" | "wav";
  speedAlpha?: number;
  generationId?: string;
}

export interface TTSResult {
  audioBuffer: ArrayBuffer;
  contentType: string;
  latencyMs: number;
  provider: "rime";
}

export interface AudioQueueItem {
  id: string;
  generationId: string;
  blob: Blob;
  text: string;
  index: number;
}

export type TTSPlaybackState = "idle" | "playing" | "paused" | "cancelled";

export interface TTSSessionCallbacks {
  onPlayStart: (generationId: string) => void;
  onAudioLevel: (level: number) => void;
  onPlayEnd: (generationId: string) => void;
  onError: (error: Error, generationId: string) => void;
  onInterSentenceWindow?: (active: boolean) => void;
}
