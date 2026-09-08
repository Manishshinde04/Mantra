🎙️ MANTRA

A real-time, multilingual AI voice assistant built for natural, low-latency conversations.

Mantra is a modern AI voice assistant that enables users to communicate naturally through speech. It combines speech recognition, Gemini-powered response generation, intelligent text segmentation, and real-time text-to-speech playback into a seamless conversational experience.

🌐 Live Website

https://voxflow-lime.vercel.app/

The deployed URL is retained for the current production deployment, while the project/product name is now MANTRA.

✨ Features

🎤 Real-Time Voice Interaction — Speak naturally and receive spoken responses.

🤖 Gemini AI Responses — Streaming AI-generated conversational responses.

🔊 Low-Latency Text-to-Speech — Responses are segmented and synthesized progressively.

⚡ Fast First Audio — Early clause segmentation reduces time-to-first-audio.

🗣️ Hands-Free Barge-In — Users can interrupt the assistant while it is speaking.

🌍 Multilingual Support — Supports language selection and Devanagari sentence boundaries.

📱 Android Support — Dedicated mobile speech-recognition flow for reliable microphone activation.

🖥️ Desktop Support — Full-duplex voice interaction with VAD and audio visualization.

🛡️ Playback Watchdog — Prevents audio stalls from freezing the conversation.

📊 End-to-End Telemetry — Structured logging across STT, Gemini, TTS, queue, session, and interruption flows.

🧠 How MANTRA Works

             ┌──────────────────────┐
             │      USER SPEECH     │
             └──────────┬───────────┘
                        │
                        ▼
             ┌──────────────────────┐
             │ Speech Recognition   │
             │       + VAD          │
             └──────────┬───────────┘
                        │
                        ▼
             ┌──────────────────────┐
             │   Gemini AI Engine   │
             │   Streaming Reply   │
             └──────────┬───────────┘
                        │
                        ▼
             ┌──────────────────────┐
             │ Sentence / Clause    │
             │     Segmenter        │
             └──────────┬───────────┘
                        │
                        ▼
             ┌──────────────────────┐
             │      Rime TTS        │
             │   Streaming Audio    │
             └──────────┬───────────┘
                        │
                        ▼
             ┌──────────────────────┐
             │   Audio Playback     │
             │   + Barge-In Control │
             └──────────────────────┘

🏗️ Technical Architecture

MANTRA uses a real-time conversational pipeline designed to minimize latency and prevent dropped audio or incomplete responses.

Voice Input

Browser Speech Recognition

Audio capture and analyser pipeline

Voice Activity Detection (VAD)

Platform-specific startup handling

Synchronous microphone activation on user gestures

AI Processing

Gemini streaming response generation

Incremental transcript processing

Trailing response-delta handling

Conversation/session management

Voice Output

Intelligent sentence and clause segmentation

Rime Text-to-Speech

Bounded concurrent TTS requests

Audio queue management

Playback watchdog and recovery

Immediate interruption / queue purge

⚡ Performance Optimizations

MANTRA includes several optimizations for real-time voice interaction:

Optimization

Result

First-clause segmentation

Faster first audio

Bounded TTS concurrency

Reduces playback starvation and rate-limit pressure

Audio playback watchdog

Prevents stalled audio from freezing sessions

Trailing stream flush

Prevents generated text from being lost

Devanagari boundaries

Better Hindi/Marathi sentence segmentation

Synchronous mobile STT startup

Reliable Android microphone activation

Barge-in handling

Fast interruption of assistant speech

Measured Improvements

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

📱 Platform Verification

Desktop

Full-duplex audio capture

Speech recognition

VAD

Audio analyser

Hands-free interruption

Continuous conversational loop

Android

Isolated Speech Recognition

continuous=false

No unnecessary getUserMedia dependency for STT

No unnecessary AudioContext dependency for STT

Reliable user-gesture microphone activation

Clean return to listening after assistant playback

🛠️ Technology Stack

Layer

Technology

Frontend

Next.js, React, TypeScript

Styling / UI

Modern responsive web UI

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

📂 Important Components

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

Core Responsibilities

ConversationManager.ts — Gemini streaming and conversation control.

useVoiceSession.ts — Main voice-session lifecycle and coordination.

VoiceInputManager.ts — Speech recognition and microphone flow.

sentenceSegmenter.ts — Splits streamed AI text into TTS-ready chunks.

TTSSession.ts — Manages TTS requests, queueing, and session states.

AudioPlayer.ts — Handles audio playback, interruption, and recovery.

🔄 Voice Conversation Flow

User taps / activates microphone
            ↓
Speech Recognition starts
            ↓
User speaks
            ↓
Transcript generated
            ↓
Gemini receives final transcript
            ↓
Gemini streams response
            ↓
Response is segmented progressively
            ↓
Rime synthesizes audio
            ↓
Audio plays immediately
            ↓
User can interrupt at any time
            ↓
MANTRA returns to listening

🧪 Testing & Verification

The project was tested for:

TypeScript compilation

Production build

Desktop voice interaction

Android voice interaction

Long AI responses

Multiple consecutive voice turns

Audio interruption / barge-in

TTS queue stability

Trailing text preservation

Devanagari sentence segmentation

Example validation commands:

npx tsc --noEmit
npm run build

🚀 Getting Started

1. Clone the repository

git clone <your-repository-url>
cd <project-directory>

2. Install dependencies

npm install

3. Configure environment variables

Create a .env.local file and add the API credentials required by the project.

GEMINI_API_KEY=your_gemini_api_key
RIME_API_KEY=your_rime_api_key

Never commit real API keys or secrets to GitHub.

4. Start development server

npm run dev

Open:

http://localhost:3000

👥 Contributors

MANTRA was developed collaboratively by the following contributors.

Manan274

Role: AI & Voice Pipeline

Worked on AI conversation and response-flow integration.

Contributed to real-time voice interaction logic.

Worked on Gemini response streaming and conversational behavior.

Assisted with voice-session debugging and optimization.

Shravan-Bhagat

Role: Frontend & User Experience

Contributed to the MANTRA web interface.

Worked on voice interaction UI and user experience.

Assisted with responsive desktop/mobile behavior.

Contributed to frontend integration and application polish.

TejasMore26

Role: Voice, Audio & Testing

Contributed to voice/audio functionality.

Worked on TTS playback and real-time audio behavior.

Assisted with interruption and voice-session testing.

Contributed to debugging and stability verification.

Contributions were collaborative, and the responsibilities above represent the primary areas of contribution.

📈 Project Highlights

Real-time AI voice conversation

Streaming Gemini responses

Progressive TTS synthesis

Low-latency first-audio delivery

Hands-free interruption

Mobile-aware speech recognition

Multilingual / Devanagari support

Robust audio queue management

Production deployment on Vercel

🌐 Try MANTRA

Live Demo

👉 https://voxflow-lime.vercel.app/

📄 License

This project is intended for educational, development, and demonstration purposes.

<div align="center">

🎙️ MANTRA

Speak naturally. Think intelligently. Respond instantly.

</div>
