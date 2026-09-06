import { AudioCaptureConfig, VoiceInputError } from "./types";

export class AudioCapture {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;

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

    // Clean up any lingering active stream first
    this.stop();

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
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);

      // Create Web Audio Context for energy measurement
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();

      // Ensure context is running (handles autoplay policy resume)
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.3;

      // Connect source to analyser only (NEVER to destination, avoiding feedback!)
      this.sourceNode.connect(this.analyserNode);

      return this.analyserNode;
    } catch (err) {
      this.stop();
      throw this.normalizeError(err);
    }
  }

  public stop(): void {
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

    // 3. Close AudioContext
    if (this.audioContext && this.audioContext.state !== "closed") {
      try {
        this.audioContext.close();
      } catch {
        // Ignore close errors
      }
      this.audioContext = null;
    }

    this.analyserNode = null;
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
