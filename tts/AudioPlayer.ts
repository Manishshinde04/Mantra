import { AudioQueueItem } from "./types";

export interface AudioPlayerCallbacks {
  onPlayStart?: (item: AudioQueueItem) => void;
  onItemEnded?: (item: AudioQueueItem) => void;
  onQueueEmpty?: (generationId: string) => void;
  onAudioLevel?: (level: number) => void;
  onError?: (error: Error, item?: AudioQueueItem) => void;
}

export class AudioPlayer {
  // Single persistent HTMLAudioElement reused across all sentences
  private audioElement: HTMLAudioElement | null = null;
  private currentBlobUrl: string | null = null;
  private animFrameId: number | null = null;
  private isPlaying: boolean = false;
  private currentItem: AudioQueueItem | null = null;
  private callbacks: AudioPlayerCallbacks;

  // Monotonic generation token to invalidate stale callbacks and prevent race conditions
  private playGeneration: number = 0;

  constructor(callbacks: AudioPlayerCallbacks = {}) {
    this.callbacks = callbacks;
  }

  private getAudioElement(): HTMLAudioElement {
    if (!this.audioElement && typeof window !== "undefined") {
      const audio = new Audio();
      audio.preload = "auto";
      // Ensure element stays ready for low-latency sequential playback
      this.audioElement = audio;
    }
    return this.audioElement!;
  }

  public async unlockAudio(): Promise<void> {
    if (typeof window === "undefined") return;

    try {
      const audio = this.getAudioElement();
      // On iOS/Chrome, touching play() or load() on user activation warms up the audio subsystem
      if (audio.paused && audio.src) {
        // Already loaded
      }
    } catch {
      // Ignore unlock notice
    }
  }

  public async playBlob(item: AudioQueueItem): Promise<void> {
    // 1. Immediately stop any active audio and bump generation token
    this.stopCurrent();

    const currentGen = ++this.playGeneration;
    this.currentItem = item;
    this.isPlaying = true;
    console.log(`[VOXFLOW-TTS] AudioPlayer.playBlob item=${item.index} size=${item.blob.size} bytes (gen=${currentGen})`);

    try {
      const audio = this.getAudioElement();
      const url = URL.createObjectURL(item.blob);
      this.currentBlobUrl = url;

      audio.src = url;

      // 2. AUDIO BUFFERING: Ensure the audio source has buffered sufficiently before calling play()
      if (audio.readyState < 2) {
        await new Promise<void>((resolve) => {
          const onReady = () => {
            audio.removeEventListener("canplay", onReady);
            audio.removeEventListener("error", onReady);
            resolve();
          };
          audio.addEventListener("canplay", onReady, { once: true });
          audio.addEventListener("error", onReady, { once: true });
        });
      }

      // Check if session was interrupted or superseded while buffering
      if (currentGen !== this.playGeneration) {
        URL.revokeObjectURL(url);
        return;
      }

      let endedSignaled = false;
      const finishItem = () => {
        if (endedSignaled || currentGen !== this.playGeneration) return;
        endedSignaled = true;
        this.stopCurrent();
        try {
          this.callbacks.onItemEnded?.(item);
        } catch (callbackErr) {
          console.warn("[AudioPlayer] Error in onItemEnded callback:", callbackErr);
        }
      };

      audio.onplay = () => {
        if (currentGen !== this.playGeneration) return;
        console.log(`[VOXFLOW-TTS] AudioPlayer audio.onplay fired for item=${item.index} readyState=${audio.readyState}`);
        try {
          this.callbacks.onPlayStart?.(item);
        } catch (err) {
          console.warn("[AudioPlayer] Error in onPlayStart callback:", err);
        }
        this.startLevelAnimation();
      };

      audio.onended = () => {
        if (currentGen !== this.playGeneration) return;
        console.log(`[VOXFLOW-TTS] AudioPlayer audio.onended fired for item=${item.index}`);
        finishItem();
      };

      audio.onerror = () => {
        if (currentGen !== this.playGeneration) return;
        console.error(`[VOXFLOW-TTS] AudioPlayer audio.onerror fired for item=${item.index}`);
        try {
          this.callbacks.onError?.(new Error("Audio playback failed for sentence chunk"), item);
        } catch {}
        finishItem();
      };

      // 3. Play natively through device speakers with zero Web Audio latency
      await audio.play();
    } catch (err: any) {
      if (currentGen !== this.playGeneration) return;
      console.error(`[VOXFLOW-TTS] AudioPlayer play() threw for item=${item.index}:`, err?.message);
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
    if (this.audioElement) {
      try {
        this.audioElement.volume = 0;
      } catch {}
    }
    this.stopCurrent();
  }

  public stopCurrent(): void {
    // Invalidate any in-flight playback generation callbacks
    this.playGeneration++;
    this.stopLevelAnimation();

    if (this.currentItem) {
      console.log(`[VOXFLOW-TTS] AudioPlayer.stopCurrent stopping item=${this.currentItem.index}`);
    }

    if (this.currentBlobUrl) {
      try {
        URL.revokeObjectURL(this.currentBlobUrl);
      } catch {}
      this.currentBlobUrl = null;
    }

    if (this.audioElement) {
      // Detach listeners before resetting src so no asynchronous event can fire
      this.audioElement.onplay = null;
      this.audioElement.onended = null;
      this.audioElement.onerror = null;
      try {
        this.audioElement.volume = 1;
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
        this.audioElement.removeAttribute("src");
        this.audioElement.load();
      } catch {}
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
    if (this.audioElement) {
      try {
        this.audioElement.pause();
        this.audioElement.removeAttribute("src");
        this.audioElement.load();
      } catch {}
      this.audioElement = null;
    }
  }

  /**
   * Smooth, lightweight speech visualizer modulation without Web Audio graph interception
   */
  private startLevelAnimation(): void {
    this.stopLevelAnimation();
    let angle = 0;

    const animate = () => {
      if (!this.isPlaying) {
        this.callbacks.onAudioLevel?.(0);
        return;
      }

      angle += 0.18;
      // Natural undulating speech energy between 0.25 and 0.70
      const base = 0.45;
      const wave = Math.sin(angle) * 0.18 + Math.cos(angle * 1.6) * 0.08;
      const level = Math.max(0.1, Math.min(1.0, base + wave));

      this.callbacks.onAudioLevel?.(level);
      this.animFrameId = requestAnimationFrame(animate);
    };

    this.animFrameId = requestAnimationFrame(animate);
  }

  private stopLevelAnimation(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }
}
