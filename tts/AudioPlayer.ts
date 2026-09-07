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

  // Safety watchdog timer to prevent audio deadlock
  private playbackWatchdogTimer: any = null;

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
      if (audio.paused && audio.src) {
        // Subsystem warm
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

    console.log("[VOXFLOW-E2E]", {
      component: "PLAYER",
      event: "load",
      sentenceIndex: item.index,
      generationId: item.generationId,
      audioBytes: item.blob.size,
      playGeneration: currentGen,
      timestamp: Date.now(),
    });

    try {
      const audio = this.getAudioElement();
      const url = URL.createObjectURL(item.blob);
      this.currentBlobUrl = url;

      console.log("[VOXFLOW-E2E]", {
        component: "PLAYER",
        event: "source changed",
        sentenceIndex: item.index,
        playGeneration: currentGen,
        timestamp: Date.now(),
      });

      audio.src = url;

      // 2. AUDIO BUFFERING: Bounded wait for canplay/loadeddata (NEVER deadlock with timeout)
      if (audio.readyState < 2) {
        await new Promise<void>((resolve) => {
          let done = false;
          const cleanup = () => {
            if (done) return;
            done = true;
            audio.removeEventListener("canplay", cleanup);
            audio.removeEventListener("loadeddata", cleanup);
            audio.removeEventListener("canplaythrough", cleanup);
            audio.removeEventListener("error", cleanup);
            clearTimeout(safetyTimer);
            resolve();
          };
          const safetyTimer = setTimeout(cleanup, 120); // 120ms max buffering delay
          audio.addEventListener("canplay", cleanup, { once: true });
          audio.addEventListener("loadeddata", cleanup, { once: true });
          audio.addEventListener("canplaythrough", cleanup, { once: true });
          audio.addEventListener("error", cleanup, { once: true });
        });
      }

      // Check if session was interrupted or superseded while buffering
      if (currentGen !== this.playGeneration) {
        URL.revokeObjectURL(url);
        return;
      }

      console.log("[VOXFLOW-E2E]", {
        component: "PLAYER",
        event: "canplay",
        sentenceIndex: item.index,
        readyState: audio.readyState,
        timestamp: Date.now(),
      });

      let endedSignaled = false;
      const finishItem = () => {
        if (endedSignaled || currentGen !== this.playGeneration) return;
        endedSignaled = true;
        this.clearWatchdog();
        this.stopCurrent();
        try {
          this.callbacks.onItemEnded?.(item);
        } catch (callbackErr) {
          console.warn("[AudioPlayer] Error in onItemEnded callback:", callbackErr);
        }
      };

      audio.onplay = () => {
        if (currentGen !== this.playGeneration) return;
        console.log("[VOXFLOW-E2E]", {
          component: "PLAYER",
          event: "playing",
          sentenceIndex: item.index,
          readyState: audio.readyState,
          duration: audio.duration || null,
          playGeneration: currentGen,
          timestamp: Date.now(),
        });
        try {
          this.callbacks.onPlayStart?.(item);
        } catch (err) {
          console.warn("[AudioPlayer] Error in onPlayStart callback:", err);
        }
        this.startLevelAnimation();

        // Safety watchdog: ensure a stalled audio element cannot hang the conversation permanently
        this.clearWatchdog();
        const durationSec = !isNaN(audio.duration) && audio.duration > 0 ? audio.duration : 12;
        const maxPlayTimeMs = Math.max(3000, Math.ceil((durationSec + 4) * 1000));
        this.playbackWatchdogTimer = setTimeout(() => {
          if (currentGen === this.playGeneration && this.isPlaying) {
            console.warn(`[VOXFLOW-E2E] PLAYER: watchdog timeout for sentence ${item.index}, advancing queue`);
            finishItem();
          }
        }, maxPlayTimeMs);
      };

      audio.onpause = () => {
        if (currentGen !== this.playGeneration) return;
        console.log("[VOXFLOW-E2E]", {
          component: "PLAYER",
          event: "pause",
          sentenceIndex: item.index,
          timestamp: Date.now(),
        });
      };

      audio.onended = () => {
        if (currentGen !== this.playGeneration) return;
        console.log("[VOXFLOW-E2E]", {
          component: "PLAYER",
          event: "ended",
          sentenceIndex: item.index,
          playGeneration: currentGen,
          timestamp: Date.now(),
        });
        finishItem();
      };

      audio.onerror = () => {
        if (currentGen !== this.playGeneration) return;
        console.error("[VOXFLOW-E2E]", {
          component: "PLAYER",
          event: "error",
          sentenceIndex: item.index,
          playGeneration: currentGen,
          timestamp: Date.now(),
        });
        try {
          this.callbacks.onError?.(new Error("Audio playback failed for sentence chunk"), item);
        } catch {}
        finishItem();
      };

      console.log("[VOXFLOW-E2E]", {
        component: "PLAYER",
        event: "play",
        sentenceIndex: item.index,
        playGeneration: currentGen,
        timestamp: Date.now(),
      });

      // 3. Play natively through device speakers with zero Web Audio latency
      await audio.play();
    } catch (err: any) {
      if (currentGen !== this.playGeneration) return;
      console.error("[VOXFLOW-E2E]", {
        component: "PLAYER",
        event: "error",
        error: err?.message || err,
        sentenceIndex: item.index,
        playGeneration: currentGen,
        timestamp: Date.now(),
      });
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
    this.clearWatchdog();
    // Invalidate any in-flight playback generation callbacks
    this.playGeneration++;
    this.stopLevelAnimation();

    if (this.currentItem) {
      console.log("[VOXFLOW-E2E]", {
        component: "PLAYER",
        event: "stop",
        sentenceIndex: this.currentItem.index,
        playGeneration: this.playGeneration,
        timestamp: Date.now(),
      });
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
      this.audioElement.onpause = null;
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

  private clearWatchdog(): void {
    if (this.playbackWatchdogTimer) {
      clearTimeout(this.playbackWatchdogTimer);
      this.playbackWatchdogTimer = null;
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
