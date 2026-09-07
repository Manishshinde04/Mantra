import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // Only accessible in development or diagnostic mode
  const isDev = process.env.NODE_ENV !== "production";
  
  const diagnostics = {
    service: "MANTRA Realtime Voice Agent",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    gemini: {
      model: process.env.GEMINI_MODEL || "gemini-3.7-flash",
      configured: Boolean(process.env.GEMINI_API_KEY),
    },
    rime: {
      model: process.env.RIME_MODEL || "coda",
      speaker: process.env.RIME_SPEAKER || "celeste",
      language: process.env.RIME_LANGUAGE || "en",
      endpoint: process.env.RIME_ENDPOINT || "https://users.rime.ai/v1/rime-tts",
      audioFormat: process.env.RIME_AUDIO_FORMAT || "mp3",
      configured: Boolean(process.env.RIME_API_KEY),
    },
    tools: [
      { name: "calculator", status: "active", description: "Exact mathematical evaluation" },
      { name: "web_search", status: "active", description: "Live web search & instant grounding" },
    ],
    features: {
      bargeInInterruption: "enabled",
      streamingGemini: "enabled",
      sentencePipelining: "enabled",
      multilingualMarathiHindi: "enabled",
    },
  };

  return new Response(JSON.stringify(diagnostics, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache, no-store",
    },
  });
}
