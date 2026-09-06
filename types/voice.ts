export type VoiceState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "error";

export interface AudioLevels {
  inputLevel: number; // 0.0 - 1.0 (real mic RMS activity)
  outputLevel: number; // 0.0 - 1.0 (agent speech activity)
}

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export interface AudioConfig {
  selectedInputId: string;
  selectedOutputId: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

export interface VoiceSessionState {
  state: VoiceState;
  isSessionActive: boolean;
  audioLevels: AudioLevels;
  isSpeaking: boolean;
  isMuted: boolean;
  errorMessage: string | null;
}
