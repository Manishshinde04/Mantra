import { GoogleGenAI } from "@google/genai";
import { AIChatMessage, AIProvider } from "./types";
import { VOXFLOW_SYSTEM_INSTRUCTION } from "./systemInstruction";

export class GeminiProvider implements AIProvider {
  private client: GoogleGenAI;
  private modelName: string;

  constructor(apiKey?: string, modelName?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is not configured. Please set GEMINI_API_KEY in .env.local.");
    }
    this.client = new GoogleGenAI({ apiKey: key });
    this.modelName = modelName || process.env.GEMINI_MODEL || "gemini-3.8-flash";
  }

  public async getStream(
    messages: AIChatMessage[],
    options?: { signal?: AbortSignal; systemInstruction?: string }
  ): Promise<AsyncIterable<any>> {
    if (!messages || messages.length === 0) {
      throw new Error("Cannot send empty message history.");
    }

    // Sanitize message turns: merge consecutive identical roles to ensure strictly valid conversation alternation
    const sanitizedContents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
    for (const m of messages) {
      if (m.role !== "user" && m.role !== "assistant") continue;
      const targetRole = m.role === "assistant" ? ("model" as const) : ("user" as const);
      const text = m.content.trim();
      if (!text) continue;

      if (
        sanitizedContents.length > 0 &&
        sanitizedContents[sanitizedContents.length - 1].role === targetRole
      ) {
        // Append to prior turn's text
        sanitizedContents[sanitizedContents.length - 1].parts[0].text += `\n${text}`;
      } else {
        sanitizedContents.push({
          role: targetRole,
          parts: [{ text }],
        });
      }
    }

    if (sanitizedContents.length === 0) {
      throw new Error("Cannot send empty message history.");
    }

    const modelsToTry = [
      this.modelName,
      this.modelName.includes("lite") ? "gemini-3.5-flash" : "gemini-3.5-flash-lite",
    ];

    let lastError: any = null;
    for (const currentModel of modelsToTry) {
      try {
        console.log(`[GEMINI] request started, turns: ${sanitizedContents.length}, model: ${currentModel}`);
        const responseStream = await this.client.models.generateContentStream({
          model: currentModel,
          contents: sanitizedContents,
          config: {
            systemInstruction:
              options?.systemInstruction || VOXFLOW_SYSTEM_INSTRUCTION,
            temperature: 0.7,
          },
        });

        return responseStream;
      } catch (err: any) {
        lastError = err;
        const status = err?.status || err?.code || 500;
        const rawMsg = (err?.message || "").toLowerCase();
        const isTransient = status === 503 || status === 429 || rawMsg.includes("unavailable") || rawMsg.includes("high demand") || rawMsg.includes("overloaded");
        if (isTransient && currentModel !== modelsToTry[modelsToTry.length - 1]) {
          console.warn(`[GEMINI] ${currentModel} returned ${status}, falling back to ${modelsToTry[1]}`);
          continue;
        }
        break;
      }
    }

    const error = lastError;
      const status = error?.status || error?.code || 500;
      const rawMsg = (error?.message || "").toLowerCase();

      const apiErr: any = new Error();

      if (status === 429 || rawMsg.includes("resource_exhausted") || rawMsg.includes("quota") || rawMsg.includes("too many requests")) {
        apiErr.status = 429;
        apiErr.code = "RATE_LIMITED";
        apiErr.message = "AI service is temporarily busy. Please try again shortly.";
        const match = rawMsg.match(/retry in ([0-9.]+)\s*s/i) || rawMsg.match(/retrydelay["']?\s*:\s*["']?([0-9]+)/i);
        if (match) {
          apiErr.retryAfter = Math.ceil(parseFloat(match[1]));
        }
        throw apiErr;
      }

      if (status === 401 || status === 403 || rawMsg.includes("api_key_invalid") || rawMsg.includes("invalid api key")) {
        apiErr.status = 401;
        apiErr.code = "AUTH_ERROR";
        apiErr.message = "MANTRA could not connect to the AI service. Please check your API key.";
        throw apiErr;
      }

      if (status === 503 || rawMsg.includes("unavailable") || rawMsg.includes("high demand")) {
        apiErr.status = 503;
        apiErr.code = "SERVICE_UNAVAILABLE";
        apiErr.message = "AI service is currently experiencing high demand. Please try again in a moment.";
        throw apiErr;
      }

      apiErr.status = 500;
      apiErr.code = "INTERNAL_ERROR";
      apiErr.message = "MANTRA couldn't process that request. Please try again.";
      throw apiErr;
  }

  public async *streamChat(
    messages: AIChatMessage[],
    options?: { signal?: AbortSignal; systemInstruction?: string }
  ): AsyncGenerator<string, void, unknown> {
    const stream = await this.getStream(messages, options);
    for await (const chunk of stream) {
      if (options?.signal?.aborted) break;
      const text = chunk.text;
      if (text) yield text;
    }
  }
}
