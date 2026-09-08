🎙️ MANTRA

A real-time, multilingual AI voice assistant designed for natural, low-latency conversations.

MANTRA is an advanced conversational voice assistant that combines speech recognition, Gemini AI, intelligent response streaming, real-time text-to-speech, audio queue management, and interruption handling into one seamless voice experience.

🌐 Live Demo

👉 https://voxflow-lime.vercel.app/

✨ Key Features

🎤 Real-time voice conversations

🤖 Gemini-powered AI responses

🔊 Streaming text-to-speech with Rime

⚡ Low-latency first-audio response

🗣️ Natural barge-in / interruption support

🌍 Multilingual voice interaction

🇮🇳 Hindi & Marathi Devanagari sentence support

📱 Android-optimized speech recognition

🖥️ Desktop full-duplex voice interaction

🛡️ Audio playback watchdog and recovery

📊 End-to-end voice pipeline telemetry

🔄 Stable multi-turn conversations

🧠 How MANTRA Works

                    ┌─────────────────┐
                    │      USER       │
                    │     SPEAKS      │
                    └────────┬────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │ Speech Recognition  │
                  │       + VAD         │
                  └──────────┬──────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │     GEMINI AI       │
                  │ Streaming Response  │
                  └──────────┬──────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │ Sentence / Clause   │
                  │     Segmenter       │
                  └──────────┬──────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │      RIME TTS       │
                  │  Streaming Audio    │
                  └──────────┬──────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │   Audio Playback    │
                  │   + Barge-In        │
                  └──────────┬──────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   LISTEN AGAIN  │
                    └─────────────────┘

🏗️ Technical Architecture

MANTRA is built around a real-time voice pipeline:

1. Voice Input

Browser Speech Recognition

Microphone handling

Voice Activity Detection

Audio analyser

Desktop and Android-specific voice flows

2. AI Processing

Gemini streaming responses

Conversation/session management

Incremental response handling

Trailing response-delta protection

3. Text Processing

Sentence segmentation

Early clause segmentation

Hindi/Marathi । and ॥ boundary support

Streaming text-to-speech chunk preparation

4. Voice Output

Rime TTS

Concurrent TTS fetching

Audio queue management

Playback watchdog

Fast interruption and queue purge

⚡ Performance Optimizations

Area

Optimization

First Audio

Early clause segmentation

TTS

Bounded concurrent requests

Playback

Duration-based watchdog

Streaming

Trailing delta flush

Languages

Devanagari sentence boundaries

Android

Synchronous speech-recognition startup

Interruption

Fast audio cutoff and queue purge

Debugging

Structured end-to-end telemetry

Before vs After

Metric

Before

After

Speech End → Gemini Request

~120 ms

~45 ms

Gemini TTFT

~950 ms

~820 ms

Time-To-First-Audio

5.2–6.8 s

1.85–2.4 s

Interruption Cutoff

350–600 ms

<30 ms

📱 Platform Support

🖥️ Desktop

Full-duplex voice architecture

Speech Recognition

VAD

Audio analyser

Hands-free barge-in

Continuous conversational loop

📱 Android

Isolated Speech Recognition flow

continuous=false

User-gesture-based microphone activation

Reliable voice input

Clean transition between speaking and listening

🛠️ Technology Stack

Layer

Technology

Frontend

Next.js, React, TypeScript

AI

Google Gemini

Speech Recognition

Web Speech API

Text-to-Speech

Rime TTS

Audio

Web Audio API

Voice Detection

VAD / AnalyserNode

Deployment

Vercel

📂 Core Components

src/
├── ai/
│   └── ConversationManager.ts
│
├── hooks/
│   └── useVoiceSession.ts
│
├── voice/
│   └── VoiceInputManager.ts
│
└── tts/
    ├── AudioPlayer.ts
    ├── TTSSession.ts
    └── sentenceSegmenter.ts

Responsibilities

ConversationManager.ts

Gemini streaming

Conversation control

Response generation

useVoiceSession.ts

Voice-session lifecycle

STT → AI → TTS coordination

Interruption handling

VoiceInputManager.ts

Speech recognition

Microphone startup

Voice input management

sentenceSegmenter.ts

Sentence detection

Clause segmentation

Devanagari punctuation handling

TTSSession.ts

TTS request management

Queue management

Concurrent fetching

Session state control

AudioPlayer.ts

Audio playback

Fast stop

Playback recovery

Watchdog handling

👥 Contributors & Contributions

MANTRA was built collaboratively by four contributors.

👑 Manish — Project Lead / Core Developer

Primary Contribution

Led the overall MANTRA project development and architecture.

Designed and coordinated the real-time voice-assistant workflow.

Worked on the integration of Gemini AI, Speech Recognition, Rime TTS, VAD, and audio playback.

Worked on the end-to-end voice conversation pipeline.

Worked on real-time response streaming and low-latency voice interaction.

Implemented and coordinated fixes for voice interruption / barge-in behavior.

Worked on desktop and Android voice-flow reliability.

Worked on audio queue, TTS sequencing, and playback stability.

Led debugging, testing, performance optimization, and production verification.

Coordinated the final deployment and project integration.

👨‍💻 Manan274 — AI & Voice Pipeline

Primary Contribution

Contributed to AI conversation and response-flow integration.

Worked on Gemini response handling.

Assisted with real-time voice interaction logic.

Contributed to voice-session debugging and optimization.

Assisted with testing the conversational pipeline.

👨‍💻 Shravan-Bhagat — Frontend & User Experience

Primary Contribution

Contributed to the MANTRA web interface.

Worked on voice interaction UI and user experience.

Assisted with responsive desktop/mobile behavior.

Contributed to frontend integration and visual application polish.

Assisted with overall usability improvements.

👨‍💻 TejasMore26 — Voice, Audio & Testing

Primary Contribution

Contributed to voice and audio functionality.

Worked on TTS playback behavior.

Assisted with interruption and voice-session testing.

Contributed to debugging voice-related issues.

Assisted with stability and end-to-end verification.

🤝 Team Collaboration

The project was developed collaboratively, with contributors working across:

Frontend development

AI integration

Voice processing

Speech recognition

Text-to-speech

Audio management

Mobile compatibility

Performance optimization

Testing and debugging

Production deployment

🧪 Testing & Verification

MANTRA was tested across multiple real-time voice scenarios:

TypeScript compilation

Production build

Desktop voice conversations

Android voice conversations

Long AI responses

Multiple consecutive voice turns

Barge-in / interruption

TTS queue stability

Audio playback recovery

Trailing response preservation

Hindi and Marathi sentence segmentation

Validation

npx tsc --noEmit
npm run build

🚀 Getting Started

Clone the repository

git clone <your-repository-url>
cd <project-directory>

Install dependencies

npm install

Configure environment variables

Create a .env.local file:

GEMINI_API_KEY=your_gemini_api_key
RIME_API_KEY=your_rime_api_key

Never commit real API keys or secrets to GitHub.

Run locally

npm run dev

Then open:

http://localhost:3000

🌐 Live Deployment

MANTRA is deployed on Vercel.

Live Website

👉 https://voxflow-lime.vercel.app/

📌 Project Highlights

Real-time AI voice assistant

Gemini streaming responses

Rime streaming TTS

Low-latency first audio

Hands-free interruption

Android voice support

Hindi / Marathi Devanagari support

Robust audio queue management

Multi-turn conversational stability

Production deployment

🎙️ MANTRA

Speak naturally. Think intelligently. Respond instantly.

<div align="center">

Built with ❤️ by the MANTRA Team

Manish • Manan274 • Shravan-Bhagat • TejasMore26

</div>
