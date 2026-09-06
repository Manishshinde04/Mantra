import { NextRequest } from "next/server";
import { RimeProvider } from "@/tts/RimeProvider";
import { TTSRequest } from "@/tts/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.RIME_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return new Response(
        JSON.stringify({
          error: "Rime API key is not configured. Please set RIME_API_KEY in .env.local.",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body.text !== "string" || body.text.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Invalid request payload. Non-empty 'text' required." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const request: TTSRequest = {
      text: body.text.trim(),
      speaker: body.speaker,
      modelId: body.modelId,
      lang: body.lang,
      audioFormat: body.audioFormat || "mp3",
      speedAlpha: body.speedAlpha,
      generationId: body.generationId,
    };

    const provider = new RimeProvider();
    const result = await provider.synthesize(request, req.signal);

    return new Response(result.audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "X-Provider": "rime",
        "X-Latency-Ms": result.latencyMs.toString(),
        "Cache-Control": "no-cache",
      },
    });
  } catch (error: any) {
    if (error.message === "ABORTED_BY_INTERRUPTION") {
      return new Response(null, { status: 499 });
    }

    const userMessage =
      error?.message || "VOXFLOW couldn't synthesize audio. Text response remains available.";
    return new Response(
      JSON.stringify({ error: userMessage }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
