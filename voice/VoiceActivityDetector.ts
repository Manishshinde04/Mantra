import { VADConfig } from "./types";

export interface VADCallbacks {
  onAudioLevel: (level: number) => void;
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
}

export class VoiceActivityDetector {
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;
  private callbacks: VADCallbacks | null = null;
  private dataArray: Uint8Array<ArrayBuffer> | null = null;

  // Configuration
  private energyThreshold: number;
  private silenceThresholdMs: number;
  private minSpeechDurationMs: number;
  private thresholdMultiplier: number = 1.0;

  // Detection state
  private isSpeaking: boolean = false;
  private speechStartTime: number = 0;
  private lastAboveThresholdTime: number = 0;

  // Sampling timer for diagnostic RMS logging
  private lastRmsLogTime: number = 0;

  constructor(config: VADConfig = {}) {
    this.energyThreshold = config.energyThreshold ?? 0.035; // Sensitivity threshold
    this.silenceThresholdMs = config.silenceThresholdMs ?? 1500; // Time in ms to consider speech ended
    this.minSpeechDurationMs = config.minSpeechDurationMs ?? 100; // Minimum speech activity to trigger
    console.log("[VOXFLOW-MIC-DEBUG] VAD created");
  }

  public setHysteresis(multiplier: number = 1.0): void {
    this.thresholdMultiplier = Math.max(0.5, multiplier);
  }

  public start(analyser: AnalyserNode, callbacks: VADCallbacks): void {
    this.stop();

    this.analyser = analyser;
    this.callbacks = callbacks;
    this.dataArray = new Uint8Array(analyser.frequencyBinCount);
    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.lastAboveThresholdTime = 0;
    this.lastRmsLogTime = performance.now();
    console.log("[VOXFLOW-MIC-DEBUG] VAD started");

    const loop = () => {
      if (!this.analyser || !this.dataArray || !this.callbacks) return;

      // Read time-domain audio data
      this.analyser.getByteTimeDomainData(this.dataArray);

      // Compute RMS (Root Mean Square)
      let sum = 0;
      for (let i = 0; i < this.dataArray.length; i++) {
        const sample = (this.dataArray[i] - 128) / 128;
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / this.dataArray.length);

      // Scale and smooth normalized level between 0.0 and 1.0
      const normalizedLevel = Math.min(1.0, Math.max(0.0, rms * 4.5));

      // Emit continuous level for orb dynamics
      this.callbacks.onAudioLevel(normalizedLevel);

      const now = performance.now();

      // Sample RMS approximately every 500ms
      if (now - this.lastRmsLogTime >= 500) {
        this.lastRmsLogTime = now;
        console.log(`[VOXFLOW-MIC-DEBUG] RMS = ${rms.toFixed(5)} (normalized = ${normalizedLevel.toFixed(4)})`);
      }

      const effectiveThreshold = this.energyThreshold * this.thresholdMultiplier;
      if (normalizedLevel > effectiveThreshold) {
        this.lastAboveThresholdTime = now;

        if (!this.isSpeaking) {
          if (this.speechStartTime === 0) {
            this.speechStartTime = now;
          } else if (now - this.speechStartTime >= this.minSpeechDurationMs) {
            this.isSpeaking = true;
            console.log("[VOXFLOW-MIC-DEBUG] VOICE START");
            this.callbacks.onSpeechStart();
          }
        }
      } else {
        // Below threshold
        if (this.isSpeaking) {
          if (now - this.lastAboveThresholdTime >= this.silenceThresholdMs) {
            this.isSpeaking = false;
            this.speechStartTime = 0;
            this.callbacks.onSpeechEnd();
          }
        } else {
          // Reset speech start window if it didn't sustain min duration
          if (now - this.speechStartTime > 300) {
            this.speechStartTime = 0;
          }
        }
      }

      this.animFrameId = requestAnimationFrame(loop);
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  public stop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.analyser = null;
    this.dataArray = null;
    this.callbacks = null;
    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.lastAboveThresholdTime = 0;
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }
}
