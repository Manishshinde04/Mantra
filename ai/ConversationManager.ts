import { AIChatMessage, StreamCallbacks } from "./types";

export class ConversationManager {
  private currentGenerationId: string | null = null;
  private abortController: AbortController | null = null;

  private currentRequestId: string | null = null;

  public async generateResponse(
    messages: AIChatMessage[],
    callbacks: StreamCallbacks,
    options?: { requestId?: string }
  ): Promise<string> {
    // 1. Cancel previous in-flight generation if any
    this.abortCurrent();

    // 2. Generate unique generation ID and request ID for this turn
    const requestId =
      options?.requestId || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const generationId = `gen-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    this.currentGenerationId = generationId;
    this.currentRequestId = requestId;
    this.abortController = new AbortController();

    const t1 = Date.now();
    let t2: number | null = null;
    let accumulated = "";

    try {
      console.log(`[CHAT] start requestId=${requestId} generationId=${generationId} turns=${messages.length}`);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages,
          generationId,
          requestId,
        }),
        signal: this.abortController.signal,
      });

      console.log(`[CHAT] responseStatus=${response.status} requestId=${requestId}`);
      if (!response.ok) {
        let errorMessage = "Something went wrong. Please try again.";
        let retryAfter: string | null = response.headers.get("Retry-After");
        try {
          const errJson = await response.json();
          if (errJson?.error) {
            errorMessage = errJson.error;
          }
          if (errJson?.retryAfter) {
            retryAfter = String(errJson.retryAfter);
          }
        } catch {
          // Non-JSON error
        }

        if (response.status === 429) {
          console.warn(
            `[CHAT] Gemini 429 requestId=${requestId}${retryAfter ? ` retryAfter=${retryAfter}s` : ""}`
          );
        }

        const customErr: any = new Error(errorMessage);
        customErr.status = response.status;
        customErr.retryAfter = retryAfter;
        throw customErr;
      }

      if (!response.body) {
        throw new Error("No response body received from chat endpoint.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Concurrency guard: check if this generation was superseded
        if (this.currentGenerationId !== generationId) {
          console.log(`[CHAT] generation ${generationId} superseded or aborted`);
          reader.cancel();
          return accumulated;
        }

        const textChunk = decoder.decode(value, { stream: true });
        if (textChunk) {
          if (t2 === null) {
            t2 = Date.now();
            console.log(`[CHAT] firstChunk requestId=${requestId} timeToFirstToken=${t2 - t1}ms`);
          }
          accumulated += textChunk;
          callbacks.onChunk(accumulated, generationId);
        }
      }

      // Check once more before finalizing
      if (this.currentGenerationId === generationId) {
        const t3 = Date.now();
        console.log(`[CHAT] streamComplete requestId=${requestId} totalTime=${t3 - t1}ms length=${accumulated.length}`);
        callbacks.onDone(accumulated, generationId);
      }

      return accumulated;
    } catch (err: any) {
      if (err.name === "AbortError" || this.currentGenerationId !== generationId) {
        // Generation was cancelled cleanly
        return accumulated;
      }

      const cleanError =
        err instanceof Error ? err : new Error("VOXFLOW couldn't process that request.");
      callbacks.onError(cleanError, generationId);
      throw cleanError;
    } finally {
      if (this.currentGenerationId === generationId) {
        this.abortController = null;
      }
    }
  }

  public abortCurrent(): void {
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {
        // Ignore abort errors
      }
      this.abortController = null;
    }
    this.currentGenerationId = null;
  }

  public getCurrentGenerationId(): string | null {
    return this.currentGenerationId;
  }
}
