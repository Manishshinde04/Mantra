import { AudioQueueItem } from "./types";

export interface AudioPlayerCallbacks {
  onPlayStart?: (item: AudioQueueItem) => void;
  onItemEnded?: (item: AudioQueueItem) => void;
  onQueueEmpty?: (generationId: string) => void;
  onAudioLevel?: (level: number) => void;
  onError?: (error: Error, item?: AudioQueueItem) => void;
}

export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private currentMediaSource: MediaElementAudioSourceNode | null = null;
  private currentElement: HTMLAudioElement | null = null;
  private currentBlobUrl: string | null = null;
  private animFrameId: number | null = null;
  private isPlaying: boolean = false;
  private currentItem: AudioQueueItem | null = null;
  private callbacks: AudioPlayerCallbacks;

  constructor(callbacks: AudioPlayerCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public async unlockAudio(): Promise<void> {
    if (typeof window === "undefined") return;

    try {
      if (!this.audioContext) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          this.audioContext = new AudioCtx();
        }
      }
      if (this.audioContext && this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }
    } catch {
      // Ignore unlock errors
    }
  }

  public async playBlob(item: AudioQueueItem): Promise<void> {
    this.stopCurrent();

    this.currentItem = item;
    this.isPlaying = true;

    try {
      await this.unlockAudio();

      const url = URL.createObjectURL(item.blob);
      this.currentBlobUrl = url;
      const audio = new Audio(url);
      this.currentElement = audio;

      // Connect to Web Audio Analyser if AudioContext is available
      if (this.audioContext) {
        try {
          if (!this.analyser) {
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 128;
            this.analyser.smoothingTimeConstant = 0.2;
            this.analyser.connect(this.audioContext.destination);
          }

          const sourceNode = this.audioContext.createMediaElementSource(audio);
          this.currentMediaSource = sourceNode;
          sourceNode.connect(this.analyser);

          this.startEnergyMonitoring();
        } catch {
          // If createMediaElementSource fails (e.g. cross-origin/re-use), HTMLAudioElement still plays normally
        }
      }

      let endedSignaled = false;
      const finishItem = () => {
        if (endedSignaled) return;
        endedSignaled = true;
        this.stopCurrent();
        try {
          this.callbacks.onItemEnded?.(item);
        } catch (callbackErr) {
          console.warn("[AudioPlayer] Error in onItemEnded callback:", callbackErr);
        }
      };

      audio.onplay = () => {
        try {
          this.callbacks.onPlayStart?.(item);
        } catch (err) {
          console.warn("[AudioPlayer] Error in onPlayStart callback:", err);
        }
      };

      audio.onended = () => {
        finishItem();
      };

      audio.onerror = () => {
        try {
          this.callbacks.onError?.(new Error("Audio playback failed for sentence chunk"), item);
        } catch {}
        finishItem();
      };

      await audio.play();
    } catch (err: any) {
      try {
        this.callbacks.onError?.(err, item);
      } catch {}
      this.stopCurrent();
      try {
        this.callbacks.onItemEnded?.(item);
      } catch {}
    }
  }

  public fastStop(): void {
    if (this.currentElement) {
      try {
        this.currentElement.volume = 0;
      } catch {}
    }
    this.stopCurrent();
  }

  public stopCurrent(): void {
    this.stopEnergyMonitoring();

    if (this.currentBlobUrl) {
      try {
        URL.revokeObjectURL(this.currentBlobUrl);
      } catch {}
      this.currentBlobUrl = null;
    }

    if (this.currentMediaSource) {
      try {
        this.currentMediaSource.disconnect();
      } catch {}
      this.currentMediaSource = null;
    }

    if (this.currentElement) {
      try {
        this.currentElement.volume = 0;
        this.currentElement.pause();
        this.currentElement.src = "";
      } catch {}
      this.currentElement = null;
    }

    this.isPlaying = false;
    this.currentItem = null;
    this.callbacks.onAudioLevel?.(0);
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getCurrentItem(): AudioQueueItem | null {
    return this.currentItem;
  }

  public dispose(): void {
    this.stopCurrent();
    if (this.audioContext && this.audioContext.state !== "closed") {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }
    this.analyser = null;
  }

  private startEnergyMonitoring(): void {
    if (!this.analyser) return;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    const monitor = () => {
      if (!this.analyser || !this.isPlaying) {
        this.callbacks.onAudioLevel?.(0);
        return;
      }

      this.analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / (dataArray.length * 255);
      // Normalized amplitude scaled for Voice Orb
      const level = Math.min(1.0, Math.max(0.0, avg * 2.2));

      this.callbacks.onAudioLevel?.(level);

      this.animFrameId = requestAnimationFrame(monitor);
    };

    this.animFrameId = requestAnimationFrame(monitor);
  }

  private stopEnergyMonitoring(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
}
