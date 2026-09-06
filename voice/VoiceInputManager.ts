import {
  AudioCaptureConfig,
  VADConfig,
  VoiceInputError,
  VoiceInputState,
  TranscriptChunk,
  VoiceInputEvents,
} from "./types";
import { VoiceEventEmitter } from "./events";
import { AudioCapture } from "./AudioCapture";
import { VoiceActivityDetector } from "./VoiceActivityDetector";

export class VoiceInputManager {
  private state: VoiceInputState = "idle";
  private audioCapture: AudioCapture;
  private vad: VoiceActivityDetector;
  private emitter: VoiceEventEmitter;

  // SpeechRecognition Lifecycle Management
  private speechRecognizer: any = null;
  private isRecognitionRunning: boolean = false;
  private isRecognitionStarting: boolean = false;
  private restartTimeout: any = null;
  private consecutiveRestarts: number = 0;
  private recognitionGeneration: number = 0;
  private configuredLanguage?: string;

  private isExplicitlyStopped: boolean = false;
  private initToken: number = 0;
  private isInitializing: boolean = false;

  constructor(vadConfig?: VADConfig) {
    this.audioCapture = new AudioCapture();
    this.vad = new VoiceActivityDetector(vadConfig);
    this.emitter = new VoiceEventEmitter();
  }

  public getState(): VoiceInputState {
    return this.state;
  }

  public on<K extends keyof VoiceInputEvents>(
    event: K,
    listener: VoiceInputEvents[K]
  ): () => void {
    return this.emitter.on(event, listener);
  }

  private isDevLogs(): boolean {
    if (process.env.NODE_ENV === "development") return true;
    if (typeof window !== "undefined" && Boolean((window as any).__VOXFLOW_DEBUG__)) return true;
    return false;
  }

  public async start(config: AudioCaptureConfig = {}): Promise<void> {
    if (this.state === "listening") {
      return;
    }

    const token = ++this.initToken;
    this.isInitializing = true;
    this.isExplicitlyStopped = false;
    this.consecutiveRestarts = 0;
    this.configuredLanguage = config.language;

    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    try {
      // 1. Capture microphone audio stream & obtain AnalyserNode
      const analyser = await this.audioCapture.start(config);

      // Check if session was stopped or superseded while awaiting getUserMedia
      if (token !== this.initToken || this.isExplicitlyStopped) {
        this.audioCapture.stop();
        this.isInitializing = false;
        return;
      }

      // 2. Start Voice Activity Detector (RMS energy + silence boundaries)
      this.vad.start(analyser, {
        onAudioLevel: (level) => this.emitter.emit("audioLevel", level),
        onSpeechStart: () => {
          console.log("[VOXFLOW MIC] voice detected");
          this.emitter.emit("speechStart");
        },
        onSpeechEnd: () => this.emitter.emit("speechEnd"),
      });

      console.log("[VOXFLOW MIC] VAD ready");
      console.log("[VOXFLOW MIC] microphone ready");

      // 3. Set state to listening BEFORE initializing & starting speech recognition
      this.state = "listening";
      this.isInitializing = false;
      if (this.isDevLogs()) {
        console.log("[VOXFLOW-MIC-DEBUG] state set to listening");
      }
      console.log("[VOXFLOW MIC] listening started");

      // 4. Safely start speech recognition with self-healing lifecycle
      this.startSpeechRecognitionSafely();

      this.emitter.emit("startListening");
    } catch (err: any) {
      this.isInitializing = false;
      if (token !== this.initToken) return;

      this.state = "error";
      const voiceError: VoiceInputError =
        err?.type && err?.message
          ? err
          : {
              type: "unknown",
              message: "Failed to initialize microphone input.",
              originalError: err,
            };

      this.stop();
      this.emitter.emit("error", voiceError);
      throw voiceError;
    }
  }

  public stop(): void {
    this.isExplicitlyStopped = true;
    this.initToken++;
    this.recognitionGeneration++;
    this.isInitializing = false;
    this.isRecognitionStarting = false;
    this.isRecognitionRunning = false;
    this.consecutiveRestarts = 0;

    // Clear any pending restart timer immediately
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    if (this.state === "idle") return;

    this.state = "idle";

    // 1. Stop VAD loop
    this.vad.stop();

    // 2. Stop native speech recognizer & detach all handlers
    if (this.speechRecognizer) {
      const rec = this.speechRecognizer;
      this.speechRecognizer = null;
      try {
        rec.onend = null;
        rec.onerror = null;
        rec.onresult = null;
        rec.onstart = null;
        rec.abort();
      } catch {
        // Ignore stop/abort errors
      }
    }

    // 3. Stop AudioCapture & release hardware tracks
    this.audioCapture.stop();

    // 4. Emit 0 level and stop event
    this.emitter.emit("audioLevel", 0);
    this.emitter.emit("stop");
  }

  public interrupt(): void {
    // Immediate stop and reset
    this.stop();
  }

  public setHysteresis(multiplier: number): void {
    this.vad.setHysteresis(multiplier);
  }

  public isCapturing(): boolean {
    return this.audioCapture.isCapturing();
  }

  public dispose(): void {
    this.stop();
    this.emitter.removeAllListeners();
    this.audioCapture.dispose();
  }

  /**
   * Schedules a SpeechRecognition restart with bounded exponential backoff.
   * Centralized single owner prevents duplicate starts and race conditions.
   */
  private scheduleSpeechRecognitionRestart(): void {
    if (this.isExplicitlyStopped || this.state !== "listening") {
      return;
    }

    // Clear any existing restart timer
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    // Guard against duplicate starts while recognition is already running/starting
    if (this.isRecognitionRunning || this.isRecognitionStarting) {
      return;
    }

    // Bounded backoff: 250ms -> 500ms -> 1000ms
    let delay = 250;
    if (this.consecutiveRestarts === 1) {
      delay = 500;
    } else if (this.consecutiveRestarts >= 2) {
      delay = 1000;
    }
    this.consecutiveRestarts++;

    if (this.isDevLogs()) {
      console.log(`[VOXFLOW-STT] scheduling restart (delay=${delay}ms, attempt=${this.consecutiveRestarts})`);
    }

    this.restartTimeout = setTimeout(() => {
      this.restartTimeout = null;
      if (this.isExplicitlyStopped || this.state !== "listening") {
        return;
      }
      if (this.isDevLogs()) {
        console.log("[VOXFLOW-STT] restart attempt");
      }
      this.startSpeechRecognitionSafely();
    }, delay);
  }

  /**
   * Safely instantiates and starts a fresh SpeechRecognition session.
   * Ensures old recognizer instances cannot leak events or cause duplicate starts.
   */
  private startSpeechRecognitionSafely(): void {
    if (typeof window === "undefined") return;

    if (this.isExplicitlyStopped || this.state !== "listening") {
      return;
    }

    if (this.isRecognitionStarting || this.isRecognitionRunning) {
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      return;
    }

    // Clean up previous instance cleanly
    if (this.speechRecognizer) {
      const prev = this.speechRecognizer;
      this.speechRecognizer = null;
      try {
        prev.onend = null;
        prev.onerror = null;
        prev.onresult = null;
        prev.onstart = null;
        prev.abort();
      } catch {}
    }

    const gen = ++this.recognitionGeneration;
    this.isRecognitionStarting = true;

    try {
      const recognizer = new SpeechRecognition();
      console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION constructor called");

      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.maxAlternatives = 1;

      // Determine explicit language: prefer configured language, then browser locale, fallback to "en-US"
      const preferredLang =
        this.configuredLanguage ||
        (typeof navigator !== "undefined" && navigator.language ? navigator.language : "") ||
        "en-US";
      recognizer.lang = preferredLang;

      console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION config:", {
        lang: recognizer.lang,
        continuous: recognizer.continuous,
        interimResults: recognizer.interimResults,
      });

      this.speechRecognizer = recognizer;

      recognizer.onstart = () => {
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onstart");
        if (gen !== this.recognitionGeneration || this.isExplicitlyStopped || this.state !== "listening") {
          try { recognizer.abort(); } catch {}
          return;
        }
        const wasRestart = this.consecutiveRestarts > 0;
        this.isRecognitionStarting = false;
        this.isRecognitionRunning = true;
        this.consecutiveRestarts = 0;
      };

      recognizer.onaudiostart = () => {
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onaudiostart");
      };

      recognizer.onsoundstart = () => {
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onsoundstart");
      };

      recognizer.onspeechstart = () => {
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onspeechstart");
      };

      recognizer.onresult = (event: any) => {
        if (gen !== this.recognitionGeneration || this.isExplicitlyStopped || this.state !== "listening") {
          return;
        }
        this.consecutiveRestarts = 0;
        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          const text = res[0]?.transcript || "";
          if (res.isFinal) {
            finalTranscript += text;
          } else {
            interimTranscript += text;
          }
        }

        const trimmedFinal = finalTranscript.trim();
        const trimmedInterim = interimTranscript.trim();

        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onresult:", {
          interim: trimmedInterim || null,
          final: trimmedFinal || null,
        });

        if (trimmedFinal) {
          this.emitter.emit("transcript", {
            text: trimmedFinal,
            isFinal: true,
            timestamp: Date.now(),
          });
        } else if (trimmedInterim) {
          this.emitter.emit("transcript", {
            text: trimmedInterim,
            isFinal: false,
            timestamp: Date.now(),
          });
        }
      };

      recognizer.onspeechend = () => {
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onspeechend");
      };

      recognizer.onsoundend = () => {
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onsoundend");
      };

      recognizer.onaudioend = () => {
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onaudioend");
      };

      recognizer.onerror = (event: any) => {
        const errCode = event.error;
        console.error("[VOXFLOW-MIC] F. SPEECH RECOGNITION onerror:", {
          error: errCode,
          message: (event as any).message || "",
          currentState: this.state,
          generationToken: gen,
          activeToken: this.recognitionGeneration,
          willRestart: (this.state === "listening" && !this.isExplicitlyStopped),
        });

        if (gen !== this.recognitionGeneration) return;

        if (errCode === "no-speech" || errCode === "aborted") {
          return;
        }

        if (errCode === "not-allowed") {
          this.emitter.emit("error", {
            type: "permission-denied",
            message: "Microphone access is blocked. Allow microphone access and try again.",
            originalError: event,
          });
        }
      };

      recognizer.onend = () => {
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onend", {
          gen,
          activeGen: this.recognitionGeneration,
          state: this.state,
          isExplicitlyStopped: this.isExplicitlyStopped,
        });

        if (gen !== this.recognitionGeneration) return;
        this.isRecognitionRunning = false;
        this.isRecognitionStarting = false;

        // If user intentionally stopped or session is no longer listening, do nothing
        if (this.isExplicitlyStopped || this.state !== "listening") {
          return;
        }

        // Otherwise, automatically schedule self-healing restart
        this.scheduleSpeechRecognitionRestart();
      };

      console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION start() called", {
        userActivationIsActive: (navigator as any)?.userActivation?.isActive,
        userActivationHasBeenActive: (navigator as any)?.userActivation?.hasBeenActive,
      });
      recognizer.start();
    } catch (err: any) {
      this.isRecognitionStarting = false;
      this.isRecognitionRunning = false;
      console.error("[VOXFLOW-MIC] F. SPEECH RECOGNITION start() threw:", {
        name: err?.name,
        message: err?.message,
      });
      if (!this.isExplicitlyStopped && this.state === "listening") {
        this.scheduleSpeechRecognitionRestart();
      }
    }
  }
}
