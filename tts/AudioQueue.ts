import { AudioQueueItem } from "./types";

export class AudioQueue {
  private queue: AudioQueueItem[] = [];
  private activeGenerationId: string | null = null;

  public setGenerationId(generationId: string): void {
    this.activeGenerationId = generationId;
    this.clear();
  }

  public enqueue(item: AudioQueueItem): boolean {
    // If the generation ID is obsolete, reject the item
    if (this.activeGenerationId && item.generationId !== this.activeGenerationId) {
      return false;
    }

    // Insert sorted by index to guarantee strict sequential ordering
    const insertIdx = this.queue.findIndex((existing) => existing.index > item.index);
    if (insertIdx === -1) {
      this.queue.push(item);
    } else {
      this.queue.splice(insertIdx, 0, item);
    }
    return true;
  }

  public dequeue(): AudioQueueItem | null {
    return this.queue.shift() || null;
  }

  public peek(): AudioQueueItem | null {
    return this.queue[0] || null;
  }

  public clear(): void {
    this.queue = [];
  }

  public size(): number {
    return this.queue.length;
  }

  public getActiveGenerationId(): string | null {
    return this.activeGenerationId;
  }
}
