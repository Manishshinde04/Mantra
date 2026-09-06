import { VoiceInputEvents } from "./types";

type Listener<T extends keyof VoiceInputEvents> = VoiceInputEvents[T];

export class VoiceEventEmitter {
  private listeners: {
    [K in keyof VoiceInputEvents]?: Set<Listener<K>>;
  } = {};

  on<K extends keyof VoiceInputEvents>(event: K, listener: Listener<K>): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set() as any;
    }
    this.listeners[event]!.add(listener);

    // Return unbind function
    return () => this.off(event, listener);
  }

  off<K extends keyof VoiceInputEvents>(event: K, listener: Listener<K>): void {
    const set = this.listeners[event];
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        delete this.listeners[event];
      }
    }
  }

  emit<K extends keyof VoiceInputEvents>(
    event: K,
    ...args: Parameters<VoiceInputEvents[K]>
  ): void {
    const set = this.listeners[event];
    if (set) {
      set.forEach((fn: any) => {
        try {
          fn(...args);
        } catch (err) {
          console.error(`[VoiceEventEmitter] Error in listener for ${event}:`, err);
        }
      });
    }
  }

  removeAllListeners(): void {
    this.listeners = {};
  }
}
