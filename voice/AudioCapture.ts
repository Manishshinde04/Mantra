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

    try {
      console.log("[VOXFLOW-MIC-DEBUG] requesting getUserMedia");
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log("[VOXFLOW-MIC-DEBUG] getUserMedia SUCCESS");
      console.log("[VOXFLOW-MIC-DEBUG] stream active =", this.stream.active);
      console.log(
        "[VOXFLOW-MIC-DEBUG] audio tracks =",
        this.stream
          .getAudioTracks()
          .map((t) => `${t.label} (enabled=${t.enabled}, readyState=${t.readyState}, muted=${t.muted})`)
          .join(", ")
      );

      // Create or reuse Web Audio Context for energy measurement
      if (!this.audioContext || this.audioContext.state === "closed") {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioCtx();
      }

      console.log(`[VOXFLOW-MIC-DEBUG] AudioContext state = ${this.audioContext.state}`);

      // Ensure context is running (handles browser autoplay resume)
      if (this.audioContext.state === "suspended") {
        console.log("[VOXFLOW-MIC-DEBUG] AudioContext resume called");
        try {
          await this.audioContext.resume();
        } catch (err) {
          console.warn("[VOXFLOW-MIC-DEBUG] AudioContext resume error:", err);
        }
        console.log(`[VOXFLOW-MIC-DEBUG] AudioContext state after resume = ${this.audioContext.state}`);
      }

      // Attach user-gesture listener as safety in case browser autoplay policy suspended it
      this.attachGestureUnlock();

      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.3;
      console.log("[VOXFLOW-MIC-DEBUG] analyser created");

      // Connect source to analyser only (NEVER to destination, avoiding feedback!)
      this.sourceNode.connect(this.analyserNode);
      console.log("[VOXFLOW-MIC-DEBUG] analyser connected");

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
    if (error instanceof DOMException) {
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        return {
          type: "permission-denied",
          message: "Microphone access is required to talk to VOXFLOW.",
          originalError: error,
        };
      }
      if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        return {
          type: "not-found",
          message: "No microphone detected on your system.",
          originalError: error,
        };
      }
      if (error.name === "NotSupportedError") {
        return {
          type: "not-supported",
          message: "Audio capture is not supported in this browser.",
          originalError: error,
        };
      }
    }

    return {
      type: "unknown",
      message: "An unexpected error occurred while starting the microphone.",
      originalError: error,
    };
  }
}
