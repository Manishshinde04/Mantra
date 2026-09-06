import { AudioCaptureConfig, VoiceInputError } from "./types";

export class AudioCapture {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private gestureListenerAttached: boolean = false;

  public static isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      !!navigator?.mediaDevices?.getUserMedia &&
      !!(window.AudioContext || (window as any).webkitAudioContext)
    );
  }

  public async start(config: AudioCaptureConfig = {}): Promise<AnalyserNode> {
    if (!AudioCapture.isSupported()) {
      throw this.normalizeError(
        new DOMException("Microphone capture is not supported in this browser.", "NotSupportedError")
      );
    }

    // Clean up any lingering active stream/source node first
    this.releaseStreamAndNodes();

    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: config.deviceId ? { exact: config.deviceId } : undefined,
        echoCancellation: config.echoCancellation ?? true,
        noiseSuppression: config.noiseSuppression ?? true,
        autoGainControl: config.autoGainControl ?? true,
      },
      video: false,
    };

    const isDev = process.env.NODE_ENV === "development";

    try {
      console.log("[VOXFLOW-MIC] C. getUserMedia() called", {
        constraints,
        userActivationIsActive: (navigator as any)?.userActivation?.isActive,
      });

      try {
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log("[VOXFLOW-MIC] C. getUserMedia() SUCCESS");
      } catch (firstErr: any) {
        console.warn("[VOXFLOW-MIC] C. getUserMedia() primary attempt threw:", {
          name: firstErr?.name,
          message: firstErr?.message,
        });
        if (firstErr?.name === "OverconstrainedError") {
          console.warn("[VOXFLOW-MIC] C. getUserMedia() retrying with basic { audio: true }");
          this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          console.log("[VOXFLOW-MIC] C. getUserMedia() fallback SUCCESS");
        } else {
          throw firstErr;
        }
      }

      const track = this.stream.getAudioTracks()[0];
      console.log("[VOXFLOW-MIC] D. MEDIA STREAM:", {
        streamActive: this.stream.active,
        audioTrackExists: !!track,
        readyState: track?.readyState,
        enabled: track?.enabled,
        muted: track?.muted,
        settings: track?.getSettings ? track.getSettings() : {},
      });

      // Create or reuse Web Audio Context for energy measurement
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const wasExisting = !!this.audioContext && this.audioContext.state !== "closed";
      if (!wasExisting) {
        this.audioContext = new AudioCtx();
      }

      console.log("[VOXFLOW-MIC] E. AUDIO CONTEXT:", {
        created: !wasExisting,
        stateBeforeResume: this.audioContext!.state,
      });

      // Ensure context is running (handles browser autoplay resume)
      if (this.audioContext!.state === "suspended") {
        console.log("[VOXFLOW-MIC] E. AUDIO CONTEXT resume() called");
        try {
          await this.audioContext!.resume();
        } catch (err: any) {
          console.warn("[VOXFLOW-MIC] E. AUDIO CONTEXT resume error:", err?.name, err?.message);
        }
      }
      console.log("[VOXFLOW-MIC] E. AUDIO CONTEXT stateAfterResume:", this.audioContext!.state);

      // Attach user-gesture listener as safety in case browser autoplay policy suspended it
      this.attachGestureUnlock();

      this.sourceNode = this.audioContext!.createMediaStreamSource(this.stream);
      this.analyserNode = this.audioContext!.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.3;
      console.log("[VOXFLOW-MIC] G. VAD analyser created");

      // Connect source to analyser only (NEVER to destination, avoiding feedback!)
      this.sourceNode.connect(this.analyserNode);
      console.log("[VOXFLOW-MIC] G. VAD analyser connected");

      // Verify analyser is active and receiving samples before declaring ready
      await this.waitForAnalyserReady(this.analyserNode);

      return this.analyserNode;
    } catch (err) {
      this.stop();
      throw this.normalizeError(err);
    }
  }

  private attachGestureUnlock(): void {
    if (this.gestureListenerAttached || typeof window === "undefined") return;
    this.gestureListenerAttached = true;

    const unlock = () => {
      if (this.audioContext && this.audioContext.state === "suspended") {
        this.audioContext.resume().then(() => {
          console.log("[VOXFLOW MIC] audio context resumed");
        }).catch(() => {});
      }
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      this.gestureListenerAttached = false;
    };

    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock, { passive: true });
  }

  private async waitForAnalyserReady(analyser: AnalyserNode, timeoutMs: number = 250): Promise<void> {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const start = performance.now();

    return new Promise((resolve) => {
      const check = () => {
        try {
          analyser.getByteTimeDomainData(data);
          let hasSamples = false;
          for (let i = 0; i < data.length; i++) {
            // Silence centers at 128 in byte time domain; unallocated is 0.
            if (data[i] !== 0) {
              hasSamples = true;
              break;
            }
          }

          if (hasSamples || (performance.now() - start >= timeoutMs)) {
            resolve();
          } else {
            requestAnimationFrame(check);
          }
        } catch {
          resolve();
        }
      };
      check();
    });
  }

  private releaseStreamAndNodes(): void {
    // 1. Release all MediaStream audio tracks
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors
        }
      });
      this.stream = null;
    }

    // 2. Disconnect source node
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.sourceNode = null;
    }

    this.analyserNode = null;
  }

  public stop(): void {
    this.releaseStreamAndNodes();
  }

  public dispose(): void {
    this.stop();
    if (this.audioContext && this.audioContext.state !== "closed") {
      try {
        this.audioContext.close();
      } catch {
        // Ignore close errors
      }
      this.audioContext = null;
    }
  }

  public getMediaStream(): MediaStream | null {
    return this.stream;
  }

  public isCapturing(): boolean {
    return this.stream !== null;
  }

  public getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  private normalizeError(error: unknown): VoiceInputError {
    const errName = (error as any)?.name || (error instanceof DOMException ? error.name : "");

    if (errName === "NotAllowedError" || errName === "PermissionDeniedError") {
      return {
        type: "permission-denied",
        message: "Microphone access is blocked. Allow microphone access and try again.",
        originalError: error,
      };
    }

    if (errName === "SecurityError") {
      return {
        type: "security",
        message: "Microphone access is not allowed by browser security policy.",
        originalError: error,
      };
    }

    if (errName === "NotFoundError" || errName === "DevicesNotFoundError") {
      return {
        type: "not-found",
        message: "No microphone was found.",
        originalError: error,
      };
    }

    if (errName === "NotReadableError" || errName === "TrackStartError") {
      return {
        type: "not-readable",
        message: "Your microphone is unavailable or being used by another application.",
        originalError: error,
      };
    }

    if (errName === "OverconstrainedError") {
      return {
        type: "overconstrained",
        message: "Your microphone does not support the requested audio settings.",
        originalError: error,
      };
    }

    if (errName === "AbortError") {
      return {
        type: "aborted",
        message: "Microphone startup was aborted. Please try again.",
        originalError: error,
      };
    }

    if (errName === "NotSupportedError") {
      return {
        type: "not-supported",
        message: "Audio capture is not supported in this browser.",
        originalError: error,
      };
    }

    return {
      type: "unknown",
      message: (error as any)?.message || "An unexpected error occurred while starting the microphone.",
      originalError: error,
    };
  }
}
