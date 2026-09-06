import { NextRequest } from "next/server";
import { GeminiProvider } from "@/ai/GeminiProvider";
import { AIChatMessage } from "@/ai/types";
import { ToolRegistry } from "@/tools";
import { VOXFLOW_SYSTEM_INSTRUCTION } from "@/ai/systemInstruction";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return new Response(
        JSON.stringify({
          error: "Gemini API key is not configured. Please set GEMINI_API_KEY in .env.local.",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Invalid request payload. 'messages' array required." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const messages: AIChatMessage[] = body.messages;
    const generationId = body.generationId || "unknown";
    const requestId = body.requestId || "unknown";
    console.log(`[CHAT API] request received requestId=${requestId} generationId=${generationId} messagesCount=${messages.length}`);

    // Tool execution pipeline: Inspect the last user message for tool intent (Calculator / Live Search)
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    let toolContextPrompt = "";

    if (lastUserMessage) {
      const text = lastUserMessage.content.trim();
      const registry = ToolRegistry.getInstance();

      // 1. Math / Calculator detection
      const isMathExpression = /^(what is |calculate |evaluate )?([0-9\s+\-*/().%^×÷]{3,}|sqrt\([0-9.]+\))$/i.test(text);
      if (isMathExpression) {
        const mathMatch = text.replace(/^(what is |calculate |evaluate )/i, "").trim();
        const calcRes = await registry.executeTool("calculator", { expression: mathMatch }, req.signal);
        if (calcRes.success && calcRes.result !== null) {
          toolContextPrompt += `\n[Tool Result: Calculator calculated exact answer: ${calcRes.result} for expression: ${mathMatch}. Use this exact value to answer.]\n`;
          console.log(`[CHAT API] calculator executed: ${mathMatch} = ${calcRes.result}`);
        }
      }

      // 2. Web search detection: Current/live queries (weather, latest news, today's events)
      const isSearchIntent = /\b(weather|latest news|today'?s match|current price|who won today|breaking news)\b/i.test(text);
      if (isSearchIntent) {
        const searchRes = await registry.executeTool("web_search", { query: text }, req.signal);
        if (searchRes.success && searchRes.result) {
          toolContextPrompt += `\n[Tool Result: Live Web Search returned:\n${searchRes.result}\nSource: ${searchRes.source}. Ground your answer strictly on this information with appropriate attribution.]\n`;
          console.log(`[CHAT API] web_search executed for: "${text}"`);
        }
      }
    }

    const provider = new GeminiProvider(apiKey);
    const systemInstruction = toolContextPrompt
      ? `${VOXFLOW_SYSTEM_INSTRUCTION}\n${toolContextPrompt}`
      : VOXFLOW_SYSTEM_INSTRUCTION;

    // Initialize handshake with Gemini before streaming response headers
    const genaiStream = await provider.getStream(messages, { systemInstruction });
    console.log(`[CHAT API] streaming started requestId=${requestId}`);

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of genaiStream) {
            const text = chunk.text;
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }
          console.log(`[CHAT API] streaming completed successfully requestId=${requestId}`);
          controller.close();
        } catch (err: any) {
          const status = err?.status || err?.code || 500;
          const rawMsg = (err?.message || "").toLowerCase();
          let userMessage = "VOXFLOW couldn't process that request. Please try again.";
          if (status === 429 || rawMsg.includes("resource_exhausted") || rawMsg.includes("quota") || rawMsg.includes("too many requests")) {
            userMessage = "AI service is temporarily busy. Please try again shortly.";
          } else if (status === 503 || rawMsg.includes("unavailable") || rawMsg.includes("high demand")) {
            userMessage = "AI service is currently experiencing high demand. Please try again in a moment.";
          } else if (err?.message && !err.message.includes("{") && !err.message.includes("status:")) {
            userMessage = err.message;
          }
          console.error(`[CHAT API] streaming error requestId=${requestId}:`, userMessage);
          controller.error(new Error(userMessage));
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: any) {
    const status = typeof error?.status === "number" && error.status >= 400 && error.status < 600
      ? error.status
      : 500;
    const userMessage =
      error?.message || "VOXFLOW couldn't process that request. Please try again.";
    const code = error?.code || "ERROR";

    console.warn(`[CHAT API] request rejected status=${status} code=${code} msg="${userMessage}"`);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache, no-store",
    };
    if (error?.retryAfter) {
      headers["Retry-After"] = String(error.retryAfter);
    }

    return new Response(
      JSON.stringify({
        error: userMessage,
        code,
        retryAfter: error?.retryAfter,
      }),
      {
        status,
        headers,
      }
    );
  }
}
