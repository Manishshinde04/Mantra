import { TTSConfig, TTSRequest, TTSResult } from "./types";

export class RimeProvider {
  private config: TTSConfig;

  constructor(config?: Partial<TTSConfig>) {
    this.config = {
      apiKey: config?.apiKey || process.env.RIME_API_KEY || "",
      endpoint: config?.endpoint || process.env.RIME_ENDPOINT || "https://users.rime.ai/v1/rime-tts",
      modelId: config?.modelId || process.env.RIME_MODEL || "coda",
      speaker: config?.speaker || process.env.RIME_SPEAKER || "celeste",
      lang: config?.lang || process.env.RIME_LANGUAGE || "en",
      audioFormat: (config?.audioFormat || process.env.RIME_AUDIO_FORMAT as any) || "mp3",
      speedAlpha: config?.speedAlpha || 1.0,
    };
  }

  public async synthesize(request: TTSRequest, signal?: AbortSignal): Promise<TTSResult> {
    const apiKey = this.config.apiKey?.trim();
    if (!apiKey) {
      throw new Error("RIME_API_KEY is not configured. Please set RIME_API_KEY in .env.local.");
    }

    const startTime = Date.now();
    const speaker = request.speaker || this.config.speaker;
    const modelId = request.modelId || this.config.modelId;
    const lang = request.lang || this.config.lang;
    const speedAlpha = request.speedAlpha || this.config.speedAlpha || 1.0;
    const audioFormat = request.audioFormat || this.config.audioFormat || "mp3";

    const payload = {
      text: request.text,
      speaker,
      modelId,
      lang,
      speedAlpha,
      samplingRate: 22050,
    };

    const acceptHeader = audioFormat === "wav" ? "audio/wav" : "audio/mp3";

    try {
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "Accept": acceptHeader,
        },
        body: JSON.stringify(payload),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown Rime error");
        if (response.status === 401 || response.status === 403) {
          throw new Error("Invalid Rime API key. Please check your credentials in .env.local.");
        }
        if (response.status === 429) {
          throw new Error("Rime API rate limit exceeded. Please try again shortly.");
        }
        throw new Error(`Rime speech synthesis failed (HTTP ${response.status}): ${errorText}`);
      }

      const audioBuffer = await response.arrayBuffer();
      const latencyMs = Date.now() - startTime;
      const contentType = response.headers.get("content-type") || "audio/mpeg";

      return {
        audioBuffer,
        contentType,
        latencyMs,
        provider: "rime",
      };
    } catch (err: any) {
      if (signal?.aborted || err.name === "AbortError") {
        throw new Error("ABORTED_BY_INTERRUPTION");
      }
      throw err;
    }
  }

  public getConfig(): TTSConfig {
    return { ...this.config };
  }
}
