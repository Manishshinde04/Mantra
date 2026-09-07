# MANTRA — Realtime Conversational Voice Agent

MANTRA is a minimal, low-latency, production-quality conversational voice agent. It pairs Google Gemini intelligence with Rime AI low-latency voice synthesis, real-time speech activity detection, seamless natural barge-in interruption, and an extensible tool engine.

---

## Architecture Overview

```
                        USER
                         │
                         ▼
                  🎤 MICROPHONE
                         │
                         ▼
                     REAL STT
                         │
                         ▼
                 FINAL TRANSCRIPT
                         │
                         ▼
              CONVERSATION MANAGER
                         │
                         ▼
                   GEMINI 3.7
                         │
                  STREAMING TEXT
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
         TEXT RESPONSE         TTS PROCESSOR
                                    │
                                    ▼
                                  RIME
                                    │
                                    ▼
                             AUDIO QUEUE
                                    │
                                    ▼
                             AUDIO PLAYER
                                    │
                                    ▼
                                  USER
```

---

## Interruption & Barge-in Pipeline

```
                      RIME SPEAKING
                           │
                     USER SPEAKS
                           │
                           ▼
                          VAD
                           │
                           ▼
                   INTERRUPT ENGINE
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
           STOP RIME   ABORT GEMINI   INVALIDATE
              │            │            │
              └────────────┼────────────┘
                           ▼
                    NEW USER TURN
                           │
                           ▼
                        GEMINI
                           │
                           ▼
                         RIME
```

---

## Gemini Configuration
- **Model**: `gemini-3.7-flash` (configured via `GEMINI_MODEL` in `.env.local`).
- **Streaming**: Native Server-Sent / ReadableStream UTF-8 token pipe.
- **Role Isolation**: Strict separation of `"user"` and `"assistant"` roles with distinct generation and turn IDs.
- **Security**: Key is loaded exclusively server-side via `process.env.GEMINI_API_KEY`.

---

## Rime TTS Configuration
- **Provider**: Rime AI (`https://users.rime.ai`)
- **Endpoint**: `https://users.rime.ai/v1/rime-tts`
- **Model**: `coda` (conversational sub-150ms latency)
- **Speaker**: `celeste`
- **Language**: `en`
- **Audio Format**: `mp3` (22,050 Hz)
- **Transport**: Streaming binary chunk delivery via `/api/tts`

---

## Extensible Tool Engine
MANTRA includes a provider-agnostic tool execution subsystem:
- **CalculatorTool**: Evaluates mathematical and arithmetic expressions with exact precision (`tools/CalculatorTool.ts`).
- **WebSearchTool**: Real-time live web query execution via DuckDuckGo Instant Answer API (`tools/WebSearchTool.ts`).
- **ToolRegistry**: Manages tool registration, inspection, and execution with AbortController signal support (`tools/ToolRegistry.ts`).

---

## Multilingual Support
- Authentically responds in **English**, **Hindi (हिंदी)**, and **Marathi (मराठी)**.
- Naturally understands colloquial code-switching (e.g., Hinglish, Marathi-English blends).

---

## Memory Architecture
- **Short-Term Memory**: Conversation history maintained in memory across multi-turn dialogues.
- **Long-Term Memory**: Persistent facts and user preferences via `LocalMemoryStore` (`memory/MemoryStore.ts` & `memory/ConversationMemory.ts`).

---

## Environment Variables

Create `.env.local` in the project root:

```env
# Google Gemini (Server-side only)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.7-flash

# Rime AI (Server-side only)
RIME_API_KEY=your_rime_api_key_here
RIME_MODEL=coda
RIME_SPEAKER=celeste
RIME_LANGUAGE=en
RIME_ENDPOINT=https://users.rime.ai/v1/rime-tts
RIME_AUDIO_FORMAT=mp3
```

---

## Security
- `GEMINI_API_KEY` and `RIME_API_KEY` are strictly server-side variables.
- Zero client bundle leakage: no `NEXT_PUBLIC_*` secrets, no secret logging, no secrets rendered in UI.

---

## Local Development & Verification

```bash
# Install dependencies
npm install

# Run TypeScript typecheck
npx tsc --noEmit

# Production build
npm run build

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to test MANTRA.

Internal developer diagnostics route: `GET /dev/diagnostics`.
