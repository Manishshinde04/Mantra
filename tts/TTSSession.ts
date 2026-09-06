import { AudioPlayer } from "./AudioPlayer";
import { SentenceSegmenter } from "./sentenceSegmenter";
import { AudioQueueItem, TTSSessionCallbacks } from "./types";

type SentenceStatus = "pending" | "synthesizing" | "ready" | "failed";

export class TTSSession {
  private generationId: string;
  private segmenter: SentenceSegmenter;
  private player: AudioPlayer;
  private callbacks: TTSSessionCallbacks;
  private abortController: AbortController | null = null;

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
  private readonly maxConcurrentFetches: number = 2; // Bounded prefetch

  // DEV-only diagnostic metrics (Section 7)
  private geminiSentenceCount: number = 0;
  private ttsDispatchedCount: number = 0;
  private ttsCompletedCount: number = 0;
  private audioPlayedCount: number = 0;

  constructor(generationId: string, player: AudioPlayer, callbacks: TTSSessionCallbacks) {
    this.generationId = generationId;
    this.player = player;
    this.callbacks = callbacks;
    this.segmenter = new SentenceSegmenter();
    this.abortController = new AbortController();
  }

  public appendTextChunk(textChunk: string): void {
    if (this.abortController?.signal.aborted) return;

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

    // Trigger workers to ensure all queued sentences are synthesized and drained
    this.pumpSynthesis();
    this.pumpPlayback();
    this.checkSessionDrain();
  }

  public cancel(): void {
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
    if (item && item.generationId !== this.generationId) return;

    this.audioPlayedCount++;
    this.isAudioPlaying = false;
    this.nextPlayIndex++;

    // Continue playback with next sequential sentence
    this.pumpPlayback();
    // Continue prefetching upcoming sentences
    this.pumpSynthesis();
    // Check if entire session has finished
    this.checkSessionDrain();
  }

  /**
   * Safe public playNext() method for defensive lifecycle and external queue triggers.
   * If audio is already playing, this safely no-ops to prevent double advancement.
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

      (async () => {
        let blob: Blob | null = null;
        let attempts = 0;
        const maxAttempts = 2; // Retry once if transient failure (Section 10)

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

        if (blob && blob.size > 0) {
          this.audioBlobs.set(index, blob);
          this.sentenceStatuses[index] = "ready";
          this.ttsCompletedCount++;
        } else {
          // Graceful handling of sentence failure: skip failed sentence, do NOT freeze or abort queue (Section 10)
          this.sentenceStatuses[index] = "failed";
          console.warn(`[TTSSession] Sentence index ${index} failed synthesis; skipping to preserve speech continuity.`);
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
        this.nextPlayIndex++;
        this.pumpPlayback();
        return;
      }

      this.audioBlobs.delete(this.nextPlayIndex); // Free blob memory immediately
      const indexToPlay = this.nextPlayIndex;
      const textToPlay = this.sentences[indexToPlay];

      this.isAudioPlaying = true;

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
      this.nextPlayIndex++;
      this.pumpPlayback();
    } else {
      // Current sentence is still pending or synthesizing.
      // Strict order: wait for this sentence to become ready before playing.
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
      this.callbacks.onPlayEnd(this.generationId);
    }
  }
}
