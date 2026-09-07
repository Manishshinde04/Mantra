import { AudioPlayer } from "./AudioPlayer";
import { SentenceSegmenter } from "./sentenceSegmenter";
import { AudioQueueItem, TTSSessionCallbacks } from "./types";

type SentenceStatus = "pending" | "synthesizing" | "ready" | "failed";
type AudioQueueState = "IDLE" | "BUFFERING" | "PLAYING" | "DRAINING" | "COMPLETED" | "INTERRUPTED";

export class TTSSession {
  private generationId: string;
  private segmenter: SentenceSegmenter;
  private player: AudioPlayer;
  private callbacks: TTSSessionCallbacks;
  private abortController: AbortController | null = null;

  // Single authoritative playback state machine
  private queueState: AudioQueueState = "IDLE";

  // Ordered sentences producer buffer
  private sentences: string[] = [];
  private sentenceStatuses: SentenceStatus[] = [];
  private audioBlobs: Map<number, Blob> = new Map();

  private isTextComplete: boolean = false;
  private hasStartedPlayback: boolean = false;
  private isAudioPlaying: boolean = false;

  private nextSynthesisIndex: number = 0;
  private nextPlayIndex: number = 0;
  private activeFetches: number = 0;
  private readonly maxConcurrentFetches: number = 3; // Bounded prefetch target (2-3 concurrent requests)

  // Dev diagnostic metrics
  private geminiSentenceCount: number = 0;
  private ttsDispatchedCount: number = 0;
  private ttsCompletedCount: number = 0;
  private audioPlayedCount: number = 0;

  private previousAudioEndedAt: number = 0;

  constructor(generationId: string, player: AudioPlayer, callbacks: TTSSessionCallbacks) {
    this.generationId = generationId;
    this.player = player;
    this.callbacks = callbacks;
    this.segmenter = new SentenceSegmenter();
    this.abortController = new AbortController();
    this.queueState = "BUFFERING";

    console.log("[VOXFLOW-E2E]", {
      component: "QUEUE",
      event: "initialized",
      generationId: this.generationId,
      queueState: this.queueState,
      timestamp: Date.now(),
    });
  }

  public appendTextChunk(textChunk: string): void {
    if (this.abortController?.signal.aborted) return;

    console.log("[VOXFLOW-E2E]", {
      component: "SEGMENTER",
      event: "chunk received",
      chunkLength: textChunk.length,
      generationId: this.generationId,
      timestamp: Date.now(),
    });

    const newSentences = this.segmenter.append(textChunk);
    for (const sentence of newSentences) {
      this.enqueueSentence(sentence);
    }
  }

  public completeText(): void {
    if (this.abortController?.signal.aborted) return;

    this.isTextComplete = true;

    // Guaranteed flush of trailing buffer (with or without punctuation)
    const flushed = this.segmenter.flush();
    for (const sentence of flushed) {
      this.enqueueSentence(sentence);
    }

    if (this.queueState === "PLAYING" || this.queueState === "BUFFERING") {
      this.queueState = "DRAINING";
      console.log("[VOXFLOW-E2E]", {
        component: "QUEUE",
        event: "state changed",
        queueState: this.queueState,
        totalSentences: this.sentences.length,
        generationId: this.generationId,
        timestamp: Date.now(),
      });
    }

    // Trigger workers to ensure all queued sentences are synthesized and drained
    this.pumpSynthesis();
    this.pumpPlayback();
    this.checkSessionDrain();
  }

  public cancel(): void {
    this.queueState = "INTERRUPTED";
    console.log("[VOXFLOW-E2E]", {
      component: "QUEUE",
      event: "queue purge",
      generationId: this.generationId,
      purgedCount: this.sentences.length - this.nextPlayIndex,
      timestamp: Date.now(),
    });

    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {
        // Ignore abort errors
      }
      this.abortController = null;
    }

    this.player.fastStop();
    this.audioBlobs.clear();
    this.sentences = [];
    this.sentenceStatuses = [];
    this.isAudioPlaying = false;
  }

  public getGenerationId(): string {
    return this.generationId;
  }

  public getDiagnostics() {
    return {
      generationId: this.generationId,
      queueState: this.queueState,
      geminiSentenceCount: this.geminiSentenceCount,
      ttsDispatchedCount: this.ttsDispatchedCount,
      ttsCompletedCount: this.ttsCompletedCount,
      audioPlayedCount: this.audioPlayedCount,
      isTextComplete: this.isTextComplete,
      isAudioPlaying: this.isAudioPlaying,
      nextPlayIndex: this.nextPlayIndex,
      totalQueued: this.sentences.length,
    };
  }

  /**
   * Called by AudioPlayer when a sentence completes its audio playback.
   */
  public onAudioItemEnded(item?: AudioQueueItem): void {
    if (this.abortController?.signal.aborted) return;
    if (item && item.generationId !== this.generationId) {
      console.warn(`[VOXFLOW-E2E] QUEUE: item ended for mismatched generation ${item.generationId}, ignoring`);
      return;
    }

    const now = Date.now();
    this.previousAudioEndedAt = now;
    const finishedIndex = item ? item.index : this.nextPlayIndex;

    this.audioPlayedCount++;
    this.isAudioPlaying = false;
    this.nextPlayIndex++;

    console.log("[VOXFLOW-E2E]", {
      component: "QUEUE",
      event: "dequeue",
      sentenceIndex: finishedIndex,
      nextIndex: this.nextPlayIndex,
      totalQueued: this.sentences.length,
      generationId: this.generationId,
      timestamp: now,
    });

    // Continue playback with next sequential sentence
    this.pumpPlayback();
    // Continue prefetching upcoming sentences
    this.pumpSynthesis();
    // Check if entire session has finished
    this.checkSessionDrain();
  }

  /**
   * Safe public playNext() method for defensive lifecycle and external queue triggers.
   */
  public playNext(): void {
    if (this.abortController?.signal.aborted) return;
    if (this.isAudioPlaying) return;
    this.pumpPlayback();
  }

  private enqueueSentence(sentenceText: string): void {
    const clean = sentenceText.trim();
    if (!clean) return;

    const index = this.sentences.length;
    this.sentences.push(clean);
    this.sentenceStatuses.push("pending");
    this.geminiSentenceCount++;

    console.log("[VOXFLOW-E2E]", {
      component: "QUEUE",
      event: "enqueue",
      sentenceIndex: index,
      sentenceTextLength: clean.length,
      queueLength: this.sentences.length,
      generationId: this.generationId,
      timestamp: Date.now(),
    });

    this.pumpSynthesis();
  }

  /**
   * Bounded concurrency synthesis worker.
   * Prefetches up to `maxConcurrentFetches` sentences concurrently while preserving order.
   */
  private pumpSynthesis(): void {
    if (this.abortController?.signal.aborted) return;

    while (
      this.activeFetches < this.maxConcurrentFetches &&
      this.nextSynthesisIndex < this.sentences.length
    ) {
      const index = this.nextSynthesisIndex++;
      const sentenceText = this.sentences[index];
      this.sentenceStatuses[index] = "synthesizing";
      this.activeFetches++;
      this.ttsDispatchedCount++;

      const ttsStart = Date.now();
      console.log("[VOXFLOW-E2E]", {
        component: "TTS",
        event: "request start",
        sentenceIndex: index,
        sentenceTextLength: sentenceText.length,
        generationId: this.generationId,
        timestamp: ttsStart,
      });

      (async () => {
        let blob: Blob | null = null;
        let attempts = 0;
        let lastStatus = 0;
        const maxAttempts = 2; // Retry transient failures once

        while (attempts < maxAttempts && !this.abortController?.signal.aborted) {
          attempts++;
          try {
            const response = await fetch("/api/tts", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                text: sentenceText,
                generationId: this.generationId,
              }),
              signal: this.abortController?.signal,
            });

            if (this.abortController?.signal.aborted) return;
            lastStatus = response.status;

            if (response.ok) {
              blob = await response.blob();
              break;
            } else {
              const errJson = await response.json().catch(() => ({}));
              console.warn(
                `[TTSSession] Synthesis notice (attempt ${attempts}) for index ${index}: ${response.status} - ${errJson?.error || ""}`
              );
              // Non-retryable authentication or configuration errors
              if (response.status === 401 || response.status === 403) break;
            }
          } catch (err: any) {
            if (err.name === "AbortError" || this.abortController?.signal.aborted) {
              return;
            }
            console.warn(`[TTSSession] Synthesis network notice (attempt ${attempts}) for index ${index}:`, err?.message);
          }
        }

        if (this.abortController?.signal.aborted) return;

        this.activeFetches--;
        const durationMs = Date.now() - ttsStart;

        if (blob && blob.size > 0) {
          this.audioBlobs.set(index, blob);
          this.sentenceStatuses[index] = "ready";
          this.ttsCompletedCount++;

          console.log("[VOXFLOW-E2E]", {
            component: "TTS",
            event: "response received",
            sentenceIndex: index,
            responseStatus: lastStatus || 200,
            audioByteCount: blob.size,
            requestDuration: durationMs,
            generationId: this.generationId,
            timestamp: Date.now(),
          });
        } else {
          // Graceful handling of sentence failure: skip failed sentence, do NOT freeze or abort queue
          this.sentenceStatuses[index] = "failed";
          console.error("[VOXFLOW-E2E]", {
            component: "TTS",
            event: "error",
            sentenceIndex: index,
            responseStatus: lastStatus || 500,
            requestDuration: durationMs,
            generationId: this.generationId,
            error: "synthesis failed after retries",
            timestamp: Date.now(),
          });
        }

        // Fill prefetch pipeline
        this.pumpSynthesis();
        // Check if playback worker can proceed
        this.pumpPlayback();
        this.checkSessionDrain();
      })();
    }
  }

  /**
   * Deterministic ordered playback worker.
   * Strictly plays Sentence 0 -> Sentence 1 -> Sentence 2 -> ... -> Sentence N.
   */
  private pumpPlayback(): void {
    if (this.abortController?.signal.aborted) return;
    if (this.isAudioPlaying) return;

    if (this.nextPlayIndex >= this.sentences.length) {
      this.checkSessionDrain();
      return;
    }

    const currentStatus = this.sentenceStatuses[this.nextPlayIndex];

    if (currentStatus === "ready") {
      const blob = this.audioBlobs.get(this.nextPlayIndex);
      if (!blob) {
        // Guard against missing blob
        console.warn(`[VOXFLOW-E2E] QUEUE: skipped index ${this.nextPlayIndex} due to missing blob`);
        this.nextPlayIndex++;
        this.pumpPlayback();
        return;
      }

      this.audioBlobs.delete(this.nextPlayIndex); // Free blob memory immediately
      const indexToPlay = this.nextPlayIndex;
      const textToPlay = this.sentences[indexToPlay];

      this.isAudioPlaying = true;
      this.queueState = "PLAYING";

      const now = Date.now();
      const gap = this.previousAudioEndedAt > 0 ? Math.max(0, now - this.previousAudioEndedAt) : 0;

      console.log("[VOXFLOW-E2E]", {
        component: "QUEUE",
        event: "playback dispatched",
        sentenceIndex: indexToPlay,
        sentenceTextLength: textToPlay.length,
        audioGapMs: gap,
        queueLength: this.sentences.length,
        generationId: this.generationId,
        timestamp: now,
      });

      if (!this.hasStartedPlayback) {
        this.hasStartedPlayback = true;
        this.callbacks.onPlayStart(this.generationId);
      }

      const item: AudioQueueItem = {
        id: `${this.generationId}-${indexToPlay}`,
        generationId: this.generationId,
        blob,
        text: textToPlay,
        index: indexToPlay,
      };

      this.player.playBlob(item);
    } else if (currentStatus === "failed") {
      // Advance past failed sentence without stalling
      console.warn(`[VOXFLOW-E2E] QUEUE: skipped index ${this.nextPlayIndex} due to failed status`);
      this.nextPlayIndex++;
      this.pumpPlayback();
    } else {
      // Current sentence is still pending or synthesizing.
      console.log("[VOXFLOW-E2E]", {
        component: "QUEUE",
        event: "waiting for synthesis",
        currentIndex: this.nextPlayIndex,
        currentStatus,
        generationId: this.generationId,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Checks if all sentences have been produced, synthesized, and played to completion.
   */
  private checkSessionDrain(): void {
    if (
      this.isTextComplete &&
      this.nextPlayIndex >= this.sentences.length &&
      !this.isAudioPlaying &&
      this.activeFetches === 0
    ) {
      this.queueState = "COMPLETED";
      console.log("[VOXFLOW-E2E]", {
        component: "QUEUE",
        event: "completed",
        totalSentencesPlayed: this.audioPlayedCount,
        generationId: this.generationId,
        timestamp: Date.now(),
      });
      this.callbacks.onPlayEnd(this.generationId);
    }
  }
}
