export type VoiceInputState = "idle" | "listening" | "error";

export type VoiceInputErrorType =
  | "permission-denied"
  | "not-found"
  | "not-supported"
  | "not-readable"
  | "overconstrained"
  | "security"
  | "aborted"
  | "unknown";

export interface VoiceInputError {
  type: VoiceInputErrorType;
  message: string;
  originalError?: unknown;
}

export interface AudioCaptureConfig {
  deviceId?: string;
  noiseSuppression?: boolean;
  echoCancellation?: boolean;
  autoGainControl?: boolean;
  language?: string;
}

export interface VADConfig {
  minSpeechDurationMs?: number;
  silenceThresholdMs?: number;
  energyThreshold?: number; // 0.0 - 1.0 threshold
}

export interface TranscriptChunk {
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export interface VoiceInputEvents {
  startListening: () => void;
  speechStart: () => void;
  speechEnd: () => void;
  audioLevel: (level: number) => void;
  transcript: (chunk: TranscriptChunk) => void;
  error: (error: VoiceInputError) => void;
  stop: () => void;
}
