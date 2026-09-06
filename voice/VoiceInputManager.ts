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
  private speechRecognizer: any = null;
  private isRecognizerActive: boolean = false;
  private restartTimeout: any = null;
  private consecutiveErrors: number = 0;
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

  public async start(config: AudioCaptureConfig = {}): Promise<void> {
    if (this.state === "listening") {
      return;
    }

    const token = ++this.initToken;
    this.isInitializing = true;
    this.isExplicitlyStopped = false;
    this.consecutiveErrors = 0;
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
      console.log("[VOXFLOW-MIC-DEBUG] state set to listening");
      console.log("[VOXFLOW MIC] listening started");

      // 4. Initialize & start speech recognition (safeStart now sees this.state === "listening")
      this.initSpeechRecognition();

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
    this.isInitializing = false;
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    if (this.state === "idle") return;

    this.state = "idle";

    // 1. Stop VAD loop
    this.vad.stop();

    // 2. Stop native speech recognizer
    if (this.speechRecognizer) {
      const rec = this.speechRecognizer;
      this.speechRecognizer = null;
      this.isRecognizerActive = false;
      try {
        rec.onend = null;
        rec.onerror = null;
        rec.onresult = null;
        rec.onstart = null;
        rec.stop();
      } catch {
        // Ignore stop errors
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

  private initSpeechRecognition(): void {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      // SpeechRecognition not supported natively in this browser;
      // Audio capture & VAD still function fully for future backend/WebSocket STT.
      return;
    }

    // Clean up any lingering previous recognizer instance
    if (this.speechRecognizer) {
      const prev = this.speechRecognizer;
      this.speechRecognizer = null;
      this.isRecognizerActive = false;
      try {
        prev.onend = null;
        prev.onerror = null;
        prev.onresult = null;
        prev.onstart = null;
        prev.abort();
      } catch {}
    }

    try {
      const recognizer = new SpeechRecognition();
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.maxAlternatives = 1;
      this.speechRecognizer = recognizer;
      console.log("[VOXFLOW-MIC-DEBUG] SpeechRecognition created");

      recognizer.onstart = () => {
        this.isRecognizerActive = true;
        console.log("[VOXFLOW-MIC-DEBUG] SpeechRecognition onstart");
      };

      recognizer.onresult = (event: any) => {
        this.consecutiveErrors = 0;
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

        if (trimmedFinal) {
          console.log(`[VOXFLOW-MIC-DEBUG] FINAL TRANSCRIPT: ${trimmedFinal}`);
          this.emitter.emit("transcript", {
            text: trimmedFinal,
            isFinal: true,
            timestamp: Date.now(),
          });
        } else if (trimmedInterim) {
          console.log(`[VOXFLOW-MIC-DEBUG] PARTIAL TRANSCRIPT: ${trimmedInterim}`);
          this.emitter.emit("transcript", {
            text: trimmedInterim,
            isFinal: false,
            timestamp: Date.now(),
          });
        }
      };

      recognizer.onerror = (event: any) => {
        console.log("[VOXFLOW-MIC-DEBUG] SpeechRecognition onerror:", event.error, (event as any).message || "");
        // Don't surface abort/no-speech as fatal errors
        if (event.error === "no-speech" || event.error === "aborted") {
          return;
        }

        this.consecutiveErrors++;
        if (event.error === "not-allowed") {
          this.emitter.emit("error", {
            type: "permission-denied",
            message: "Microphone permission is required to transcribe speech.",
            originalError: event,
          });
        }
      };

      recognizer.onend = () => {
        this.isRecognizerActive = false;
        console.log("[VOXFLOW-MIC-DEBUG] SpeechRecognition onend");
        if (this.isExplicitlyStopped || this.state !== "listening" || this.speechRecognizer !== recognizer) {
          return;
        }

        // Throttle restarts if network or service errors occurred
        if (this.consecutiveErrors > 4) {
          console.warn("[VOXFLOW-MIC-DEBUG] Pausing speech recognizer restarts after repeated errors.");
          return;
        }

        const delay = this.consecutiveErrors > 0 ? 1000 : 150;
        this.restartTimeout = setTimeout(() => {
          if (this.state === "listening" && !this.isExplicitlyStopped && this.speechRecognizer === recognizer) {
            safeStart();
          }
        }, delay);
      };

      const safeStart = (retries = 3) => {
        if (this.isExplicitlyStopped || this.state !== "listening" || this.speechRecognizer !== recognizer) {
          return;
        }
        try {
          console.log("[VOXFLOW-MIC-DEBUG] SpeechRecognition.start() called");
          recognizer.start();
          this.isRecognizerActive = true;
        } catch (err: any) {
          console.log("[VOXFLOW-MIC-DEBUG] SpeechRecognition.start() threw:", err?.name, err?.message);
          if (err?.name === "InvalidStateError" && retries > 0) {
            // Previous recognition instance is still ending; retry shortly
            setTimeout(() => safeStart(retries - 1), 150);
          } else {
            console.warn("[VOXFLOW-MIC-DEBUG] Speech recognition start notice:", err?.message || err);
          }
        }
      };

      safeStart();
    } catch (e) {
      console.warn("[VOXFLOW-MIC-DEBUG] Failed to instantiate browser SpeechRecognition:", e);
    }
  }
}
