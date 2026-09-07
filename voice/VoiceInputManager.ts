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
  private isBargeInActive: boolean = false;
  private initToken: number = 0;
  private isInitializing: boolean = false;

  // Android Echo & Interruption State Machine
  private isTTSPlaying: boolean = false;
  private androidSpeechState:
    | "IDLE"
    | "LISTENING"
    | "THINKING"
    | "SPEAKING"
    | "INTERRUPTION_LISTENING"
    | "BARGE_IN" = "IDLE";

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

  public start(config: AudioCaptureConfig = {}): void {
    if (this.state === "listening") {
      return;
    }

    const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
    const tStart = performance.now();
    const token = ++this.initToken;
    this.isInitializing = true;
    this.isExplicitlyStopped = false;
    this.consecutiveRestarts = 0;
    this.configuredLanguage = config.language;
    if (isAndroid) {
      this.androidSpeechState = "LISTENING";
      this.isTTSPlaying = false;
    }

    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    // 1. Immediately switch state to listening so SpeechRecognition can start cleanly
    this.state = "listening";
    this.emitter.emit("startListening");

    // Android diagnostic logging
    console.log("[VOXFLOW-ANDROID] platform:", isAndroid ? "Android" : "Desktop");
    console.log("[VOXFLOW-ANDROID] recognition.start()");
    console.log("[VOXFLOW-ANDROID] getUserMedia called?", isAndroid ? "false" : "true (desktop background)");
    console.log("[VOXFLOW-ANDROID] AudioContext created?", isAndroid ? "false" : "true (desktop background)");
    console.log("[VOXFLOW-ANDROID] VAD started?", isAndroid ? "false" : "true (desktop background)");

    // 2. SYNCHRONOUS: Start speech recognition right now within the user gesture call stack
    console.log("[VOXFLOW-MIC] start() synchronously calling startSpeechRecognitionSafely()", {
      perfNow: tStart,
      userActivationIsActive: (navigator as any)?.userActivation?.isActive,
      userActivationHasBeenActive: (navigator as any)?.userActivation?.hasBeenActive,
    });
    this.startSpeechRecognitionSafely(tStart);

    // 3. BACKGROUND: Desktop initializes AudioCapture and VAD concurrently.
    // Android BYPASSES getUserMedia completely so SpeechRecognition owns the microphone exclusively.
    if (isAndroid) {
      this.isInitializing = false;
    } else {
      void this.initializeAudioCaptureInBackground(config, token);
    }
  }

  /**
   * Sets the active TTS playback status to coordinate Android microphone listening
   */
  public setTTSPlaying(playing: boolean): void {
    const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
    this.isTTSPlaying = playing;
    if (isAndroid) {
      if (playing) {
        console.log("[VOXFLOW-ANDROID-ECHO] ttsStart", {
          timestamp: Date.now(),
          ttsPlaying: true,
          speechRecognitionState: this.isRecognitionRunning ? "running" : "stopped",
          currentState: this.androidSpeechState,
        });
        // When Android assistant TTS starts, temporarily stop/pause Android SpeechRecognition
        // so it cannot recognize the assistant's own output!
        if (this.speechRecognizer) {
          try {
            this.speechRecognizer.onend = null;
            this.speechRecognizer.onerror = null;
            this.speechRecognizer.abort();
          } catch {}
          this.speechRecognizer = null;
          this.isRecognitionRunning = false;
          this.isRecognitionStarting = false;
          console.log("[VOXFLOW-ANDROID-ECHO] recognitionStop", {
            reason: "Paused for assistant TTS playback onset",
            timestamp: Date.now(),
            ttsPlaying: true,
            speechRecognitionState: "stopped",
          });
        }
        this.androidSpeechState = "SPEAKING";
      } else {
        console.log("[VOXFLOW-ANDROID-ECHO] ttsStop", {
          timestamp: Date.now(),
          ttsPlaying: false,
          speechRecognitionState: this.isRecognitionRunning ? "running" : "stopped",
          currentState: this.androidSpeechState,
        });
      }
    }
  }

  /**
   * Android Controlled Interruption Listening Window:
   * Activated during inter-sentence pauses or cadenced intervals where the speaker is silent.
   */
  public startInterruptionListeningWindow(durationMs: number = 500): void {
    const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
    if (!isAndroid || this.isExplicitlyStopped) return;

    this.androidSpeechState = "INTERRUPTION_LISTENING";
    this.isBargeInActive = true;
    this.state = "listening";

    console.log("[VOXFLOW-ANDROID-ECHO] speechRecognitionState: INTERRUPTION_LISTENING", {
      timestamp: Date.now(),
      ttsPlaying: this.isTTSPlaying,
      durationMs,
    });
    console.log("[VOXFLOW-ANDROID-ECHO] recognitionStart", {
      timestamp: Date.now(),
      state: "INTERRUPTION_LISTENING",
      ttsPlaying: this.isTTSPlaying,
    });

    this.startSpeechRecognitionSafely(performance.now());
  }

  /**
   * Closes the Android Interruption Listening Window before the next sentence begins playback
   */
  public stopInterruptionListeningWindow(): void {
    const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
    if (!isAndroid) return;

    if (this.androidSpeechState === "INTERRUPTION_LISTENING") {
      this.androidSpeechState = "SPEAKING";
      if (this.speechRecognizer) {
        try {
          this.speechRecognizer.onend = null;
          this.speechRecognizer.onerror = null;
          this.speechRecognizer.abort();
        } catch {}
        this.speechRecognizer = null;
        this.isRecognitionRunning = false;
        this.isRecognitionStarting = false;
        console.log("[VOXFLOW-ANDROID-ECHO] recognitionStop", {
          reason: "Interruption window elapsed; preparing next audio sentence",
          timestamp: Date.now(),
          state: "SPEAKING",
          ttsPlaying: this.isTTSPlaying,
        });
      }
    }
  }

  /**
   * Android Hands-Free Barge-In:
   * Called when assistant begins SPEAKING audio.
   * Desktop: keeps full-duplex capture active.
   * Android: explicitly marks state as SPEAKING without blindly running recognition.
   */
  public startBargeInListening(config: AudioCaptureConfig = {}): void {
    const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
    if (!isAndroid) {
      // Desktop already has continuous full-duplex listening active.
      if (this.state !== "listening") {
        this.start(config);
      }
      return;
    }

    if (this.isExplicitlyStopped) {
      return;
    }

    this.isBargeInActive = true;
    this.configuredLanguage = config.language;
    this.consecutiveRestarts = 0;
    this.androidSpeechState = "SPEAKING";

    console.log("[VOXFLOW-ANDROID-ECHO] speechRecognitionState: SPEAKING", {
      timestamp: Date.now(),
      ttsPlaying: this.isTTSPlaying,
      note: "Android SpeechRecognition paused for TTS onset; waiting for controlled listening window",
    });
  }

  /**
   * Called when barge-in is triggered by genuine user speech to claim the turn.
   */
  public onBargeInTriggered(): void {
    this.isBargeInActive = false;
    this.state = "listening";
    this.androidSpeechState = "BARGE_IN";
    console.log("[VOXFLOW-ANDROID-ECHO] speechRecognitionState: BARGE_IN", {
      timestamp: Date.now(),
      note: "User claimed turn, capturing full utterance",
    });
  }

  /**
   * Called when assistant speech finishes normally without interruption.
   * Safely terminates the barge-in recognizer and cleanly returns to idle.
   */
  public stopBargeInListening(): void {
    this.isBargeInActive = false;
    const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
    if (isAndroid) {
      this.androidSpeechState = "IDLE";
      this.isTTSPlaying = false;
      if (this.speechRecognizer) {
        try {
          this.speechRecognizer.onend = null;
          this.speechRecognizer.onerror = null;
          this.speechRecognizer.abort();
        } catch {}
        this.speechRecognizer = null;
      }
      this.isRecognitionRunning = false;
      this.isRecognitionStarting = false;
      this.state = "idle";
      this.emitter.emit("stop");
      console.log("[VOXFLOW-ANDROID-ECHO] speechRecognitionState: IDLE", {
        timestamp: Date.now(),
        note: "Playback complete, now idle",
      });
    }
  }

  private async initializeAudioCaptureInBackground(
    config: AudioCaptureConfig,
    token: number
  ): Promise<void> {
    try {
      // Capture microphone audio stream & obtain AnalyserNode
      const analyser = await this.audioCapture.start(config);

      // Check if session was stopped or superseded while awaiting getUserMedia
      if (
        token !== this.initToken ||
        this.isExplicitlyStopped ||
        this.state !== "listening"
      ) {
        this.audioCapture.stop();
        this.isInitializing = false;
        return;
      }

      // Start Voice Activity Detector (RMS energy + silence boundaries)
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
      this.isInitializing = false;
    } catch (err: any) {
      this.isInitializing = false;
      if (token !== this.initToken || this.isExplicitlyStopped) return;

      console.warn("[VOXFLOW MIC] Background audio capture error:", err?.message || err);

      // If microphone access was explicitly blocked, emit permission error
      const errName = (err as any)?.name || (err as any)?.type || "";
      if (
        errName === "NotAllowedError" ||
        errName === "PermissionDeniedError" ||
        err?.type === "permission-denied"
      ) {
        this.state = "error";
        const voiceError: VoiceInputError = {
          type: "permission-denied",
          message: "Microphone access is blocked. Allow microphone access and try again.",
          originalError: err,
        };
        this.stop();
        this.emitter.emit("error", voiceError);
      }
    }
  }

  public stop(): void {
    this.isBargeInActive = false;
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
    if (
      this.isExplicitlyStopped ||
      this.state !== "listening" ||
      (typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent))
    ) {
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
  private startSpeechRecognitionSafely(tStart: number = performance.now()): void {
    if (typeof window === "undefined") return;

    if (this.isExplicitlyStopped || this.state !== "listening") {
      return;
    }

    if (this.isRecognitionStarting || this.isRecognitionRunning) {
      return;
    }

    const isAndroid =
      typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
    const hasStandardSR = Boolean((window as any).SpeechRecognition);
    const hasWebkitSR = Boolean((window as any).webkitSpeechRecognition);
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    console.log("[VOXFLOW-ANDROID] 2. SPEECH RECOGNITION AVAILABILITY:", {
      platform: isAndroid ? "Android" : "Desktop",
      speechRecognitionExists: hasStandardSR,
      webkitSpeechRecognitionExists: hasWebkitSR,
      constructorSelected: hasWebkitSR && !hasStandardSR ? "webkitSpeechRecognition" : hasStandardSR ? "SpeechRecognition" : "none",
      recognizerCreatedSuccessfully: Boolean(SpeechRecognition),
    });

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

      // Desktop uses continuous: true for streaming dictation; Android MUST use continuous: false
      recognizer.continuous = !isAndroid;
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
        platform: isAndroid ? "Android" : "Desktop",
      });

      this.speechRecognizer = recognizer;

      recognizer.onstart = () => {
        console.log("[VOXFLOW-ANDROID] onstart", { timestamp: Date.now(), delayMs: performance.now() - tStart });
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onstart");
        if (gen !== this.recognitionGeneration || this.isExplicitlyStopped || this.state !== "listening") {
          try { recognizer.abort(); } catch {}
          return;
        }
        const wasRestart = this.consecutiveRestarts > 0;
        this.isRecognitionStarting = false;
        this.isRecognitionRunning = true;
        this.consecutiveRestarts = 0;
        if (isAndroid) {
          this.emitter.emit("audioLevel", 0);
        }
      };

      recognizer.onaudiostart = () => {
        console.log("[VOXFLOW-ANDROID] onaudiostart", { timestamp: Date.now() });
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onaudiostart");
      };

      recognizer.onsoundstart = () => {
        console.log("[VOXFLOW-ANDROID] onsoundstart", { timestamp: Date.now() });
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onsoundstart");
      };

      recognizer.onspeechstart = () => {
        console.log("[VOXFLOW-ANDROID] onspeechstart", { timestamp: Date.now() });
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onspeechstart");
        if (isAndroid) {
          this.emitter.emit("speechStart");
          this.emitter.emit("audioLevel", 0.45);
        }
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

        console.log("[VOXFLOW-ANDROID] onresult", {
          interim: trimmedInterim || null,
          final: trimmedFinal || null,
          timestamp: Date.now(),
        });
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onresult:", {
          interim: trimmedInterim || null,
          final: trimmedFinal || null,
        });

        if (trimmedFinal) {
          if (isAndroid) {
            console.log("[VOXFLOW-ANDROID-ECHO] recognitionResult", {
              final: trimmedFinal,
              timestamp: Date.now(),
              currentState: this.androidSpeechState,
              ttsPlaying: this.isTTSPlaying,
            });
            const isInterruptionListening = this.androidSpeechState === "INTERRUPTION_LISTENING";
            const isCandidate = this.isTTSPlaying || (!isInterruptionListening && this.androidSpeechState === "SPEAKING");

            this.isBargeInActive = false;
            this.emitter.emit("audioLevel", 0);
            this.emitter.emit("transcript", {
              text: trimmedFinal,
              isFinal: true,
              timestamp: Date.now(),
              isCandidate,
            });
            this.emitter.emit("speechEnd");
            return;
          }
          this.emitter.emit("transcript", {
            text: trimmedFinal,
            isFinal: true,
            timestamp: Date.now(),
          });
        } else if (trimmedInterim) {
          if (isAndroid) {
            console.log("[VOXFLOW-ANDROID-ECHO] recognitionResult", {
              interim: trimmedInterim,
              timestamp: Date.now(),
              currentState: this.androidSpeechState,
              ttsPlaying: this.isTTSPlaying,
            });
            const isInterruptionListening = this.androidSpeechState === "INTERRUPTION_LISTENING";
            const isCandidate = this.isTTSPlaying || (!isInterruptionListening && this.androidSpeechState === "SPEAKING");

            this.isBargeInActive = false;
            this.emitter.emit("speechStart");
            this.emitter.emit("audioLevel", 0.65);
            this.emitter.emit("transcript", {
              text: trimmedInterim,
              isFinal: false,
              timestamp: Date.now(),
              isCandidate,
            });
            return;
          }
          this.emitter.emit("transcript", {
            text: trimmedInterim,
            isFinal: false,
            timestamp: Date.now(),
          });
        }
      };

      recognizer.onspeechend = () => {
        console.log("[VOXFLOW-ANDROID] onspeechend", { timestamp: Date.now() });
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onspeechend");
        if (isAndroid) {
          this.emitter.emit("speechEnd");
          this.emitter.emit("audioLevel", 0);
        }
      };

      recognizer.onsoundend = () => {
        console.log("[VOXFLOW-ANDROID] onsoundend", { timestamp: Date.now() });
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onsoundend");
      };

      recognizer.onaudioend = () => {
        console.log("[VOXFLOW-ANDROID] onaudioend", { timestamp: Date.now() });
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onaudioend");
      };

      recognizer.onerror = (event: any) => {
        const errCode = event.error;
        console.error("[VOXFLOW-ANDROID] onerror", {
          error: errCode,
          message: (event as any).message || "",
          timestamp: Date.now(),
          currentState: this.state,
        });
        console.error("[VOXFLOW-MIC] F. SPEECH RECOGNITION onerror:", {
          error: errCode,
          message: (event as any).message || "",
          currentState: this.state,
          generationToken: gen,
          activeToken: this.recognitionGeneration,
          willRestart: (this.state === "listening" && !this.isExplicitlyStopped),
        });

        if (gen !== this.recognitionGeneration) return;

        if (isAndroid) {
          this.isRecognitionRunning = false;
          this.isRecognitionStarting = false;
          if (errCode === "not-allowed") {
            this.isBargeInActive = false;
            this.androidSpeechState = "IDLE";
            this.state = "error";
            this.emitter.emit("error", {
              type: "permission-denied",
              message: "Microphone access is blocked. Allow microphone access and try again.",
              originalError: event,
            });
            this.stop();
            return;
          }
          // On Android: silence timeout (no-speech) during barge-in listening is expected
          if (errCode === "no-speech" && (this.androidSpeechState === "INTERRUPTION_LISTENING" || this.isBargeInActive) && !this.isExplicitlyStopped) {
            return;
          }
          if (errCode === "audio-capture" || errCode === "no-speech" || errCode === "aborted") {
            this.isBargeInActive = false;
            if (this.state === "listening" && this.androidSpeechState !== "INTERRUPTION_LISTENING" && this.androidSpeechState !== "SPEAKING") {
              this.state = "idle";
              this.androidSpeechState = "IDLE";
              this.emitter.emit("stop");
            }
            return;
          }
          return;
        }

        // Desktop error handling (100% unchanged)
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
        console.log("[VOXFLOW-ANDROID] onend", {
          timestamp: Date.now(),
          currentState: this.state,
          gen,
          activeGen: this.recognitionGeneration,
          platform: isAndroid ? "Android" : "Desktop",
          isBargeInActive: this.isBargeInActive,
          androidSpeechState: this.androidSpeechState,
        });
        console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION onend", {
          gen,
          activeGen: this.recognitionGeneration,
          state: this.state,
          isExplicitlyStopped: this.isExplicitlyStopped,
        });

        if (gen !== this.recognitionGeneration) return;
        this.isRecognitionRunning = false;
        this.isRecognitionStarting = false;

        // Android lifecycle:
        if (isAndroid) {
          this.speechRecognizer = null;
          console.log("[VOXFLOW-ANDROID-ECHO] recognitionEnd", {
            timestamp: Date.now(),
            currentState: this.androidSpeechState,
            ttsPlaying: this.isTTSPlaying,
            isBargeInActive: this.isBargeInActive,
          });

          // Single utterance lifecycle ended:
          if (
            this.state === "listening" &&
            this.androidSpeechState !== "INTERRUPTION_LISTENING" &&
            this.androidSpeechState !== "SPEAKING"
          ) {
            this.state = "idle";
            this.androidSpeechState = "IDLE";
            this.emitter.emit("stop");
          }
          return;
        }

        // Desktop: Automatic self-healing restart (100% unchanged)
        if (this.isExplicitlyStopped || this.state !== "listening") {
          return;
        }
        this.scheduleSpeechRecognitionRestart();
      };

      console.log("[VOXFLOW-ANDROID] 3. IMMEDIATE START:", {
        timestamp: Date.now(),
        delayFromTapMs: performance.now() - tStart,
        userActivationIsActive: (navigator as any)?.userActivation?.isActive,
        userActivationHasBeenActive: (navigator as any)?.userActivation?.hasBeenActive,
      });
      console.log("[VOXFLOW-MIC] F. SPEECH RECOGNITION start() called", {
        userActivationIsActive: (navigator as any)?.userActivation?.isActive,
        userActivationHasBeenActive: (navigator as any)?.userActivation?.hasBeenActive,
      });
      recognizer.start();
    } catch (err: any) {
      this.isRecognitionStarting = false;
      this.isRecognitionRunning = false;
      console.error("[VOXFLOW-ANDROID] 3. IMMEDIATE START SYNCHRONOUS EXCEPTION:", {
        name: err?.name,
        message: err?.message,
      });
      console.error("[VOXFLOW-MIC] F. SPEECH RECOGNITION start() threw:", {
        name: err?.name,
        message: err?.message,
      });
      if (!isAndroid && !this.isExplicitlyStopped && this.state === "listening") {
        this.scheduleSpeechRecognitionRestart();
      } else if (isAndroid && this.state === "listening") {
        this.state = "idle";
        this.emitter.emit("stop");
      }
    }
  }
}
