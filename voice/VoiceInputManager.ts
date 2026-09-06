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

    this.isExplicitlyStopped = false;
    this.consecutiveErrors = 0;
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    try {
      // 1. Capture microphone audio stream & obtain AnalyserNode
      const analyser = await this.audioCapture.start(config);

      // 2. Start Voice Activity Detector (RMS energy + silence boundaries)
      this.vad.start(analyser, {
        onAudioLevel: (level) => this.emitter.emit("audioLevel", level),
        onSpeechStart: () => this.emitter.emit("speechStart"),
        onSpeechEnd: () => this.emitter.emit("speechEnd"),
      });

      // 3. Initialize & start speech recognition if available in browser
      this.initSpeechRecognition();

      this.state = "listening";
      this.emitter.emit("startListening");
    } catch (err: any) {
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
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    if (this.state === "idle") return;

    this.state = "idle";

    // 1. Stop VAD loop
    this.vad.stop();

    // 2. Stop native speech recognizer
    if (this.speechRecognizer && this.isRecognizerActive) {
      try {
        this.speechRecognizer.stop();
      } catch {
        // Ignore recognizer stop errors
      }
      this.isRecognizerActive = false;
    }

    // 3. Completely stop AudioCapture & release hardware tracks
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
    if (this.speechRecognizer) {
      try {
        this.speechRecognizer.abort();
      } catch {
        // Ignore abort errors
      }
      this.speechRecognizer = null;
    }
  }

  private restartTimeout: any = null;
  private consecutiveErrors: number = 0;
  private isExplicitlyStopped: boolean = false;

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

    try {
      this.speechRecognizer = new SpeechRecognition();
      this.speechRecognizer.continuous = true;
      this.speechRecognizer.interimResults = true;
      this.speechRecognizer.maxAlternatives = 1;

      this.speechRecognizer.onresult = (event: any) => {
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

      this.speechRecognizer.onerror = (event: any) => {
        // Don't surface abort/no-speech as fatal errors
        if (event.error === "no-speech" || event.error === "aborted") {
          return;
        }

        this.consecutiveErrors++;
        console.warn("[VoiceInputManager] Speech recognition notice:", event.error);
        if (event.error === "not-allowed") {
          this.emitter.emit("error", {
            type: "permission-denied",
            message: "Microphone permission is required to transcribe speech.",
            originalError: event,
          });
        }
      };

      this.speechRecognizer.onend = () => {
        this.isRecognizerActive = false;
        if (this.isExplicitlyStopped || this.state !== "listening") return;

        // Throttle restarts if network or service errors occurred
        if (this.consecutiveErrors > 4) {
          console.warn("[VoiceInputManager] Pausing speech recognizer restarts after repeated errors.");
          return;
        }

        const delay = this.consecutiveErrors > 0 ? 1000 : 150;
        this.restartTimeout = setTimeout(() => {
          if (this.state === "listening" && !this.isExplicitlyStopped && !this.isRecognizerActive) {
            try {
              this.speechRecognizer.start();
              this.isRecognizerActive = true;
            } catch {
              // Ignore restart errors
            }
          }
        }, delay);
      };

      this.speechRecognizer.start();
      this.isRecognizerActive = true;
    } catch (e) {
      console.warn("[VoiceInputManager] Failed to start browser SpeechRecognition:", e);
    }
  }
}
