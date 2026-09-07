"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  VoiceSessionState,
  AudioConfig,
} from "@/types/voice";
import { TranscriptMessage } from "@/types/conversation";
import { VoiceInputManager } from "@/voice/VoiceInputManager";
import { TranscriptChunk, VoiceInputError } from "@/voice/types";
import { ConversationManager } from "@/ai/ConversationManager";
import { AIChatMessage } from "@/ai/types";
import { AudioPlayer } from "@/tts/AudioPlayer";
import { TTSSession } from "@/tts/TTSSession";

export function useVoiceSession() {
  const [session, setSession] = useState<VoiceSessionState>({
    state: "idle",
    isSessionActive: false,
    audioLevels: { inputLevel: 0, outputLevel: 0 },
    isSpeaking: false,
    isMuted: false,
    errorMessage: null,
  });

  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [currentPartialTranscript, setCurrentPartialTranscript] = useState<string>("");

  const [audioConfig, setAudioConfig] = useState<AudioConfig>({
    selectedInputId: "default",
    selectedOutputId: "default",
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
  });

  const managerRef = useRef<VoiceInputManager | null>(null);
  const conversationManagerRef = useRef<ConversationManager | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  const activeTtsSessionRef = useRef<TTSSession | null>(null);

  const activeUserMsgIdRef = useRef<string | null>(null);
  const messagesRef = useRef<TranscriptMessage[]>(messages);
  messagesRef.current = messages;

  const sessionStateRef = useRef<VoiceSessionState["state"]>(session.state);
  sessionStateRef.current = session.state;

  // Track processed final transcripts to prevent duplicate generation calls
  const lastProcessedTranscriptRef = useRef<string>("");
  const playbackStartTimeRef = useRef<number>(0);

  // Internal observability metrics (timestamps for performance evidence)
  const telemetryRef = useRef({
    turnFinalized: 0,
    geminiStarted: 0,
    firstGeminiText: 0,
    firstRimeRequest: 0,
    firstRimeAudio: 0,
    firstPlaybackStarted: 0,
    playbackCompleted: 0,
    interruptionCutoffMs: 0,
  });

  // Track in-flight generation state to strictly prevent duplicate submissions
  const isGeneratingRef = useRef<boolean>(false);

  // Android Acoustic Silence Verification Refs
  const androidCandidateRef = useRef<{
    initialText: string;
    timestamp: number;
    confirmed: boolean;
  } | null>(null);
  const androidVerificationTimerRef = useRef<any>(null);

  // Cancel any active Rime speech, playback, and queued audio
  const cancelCurrentSpeech = useCallback(() => {
    isGeneratingRef.current = false;
    console.log("[VOXFLOW-E2E] [BARGE-IN] Rime stop, queue purge, generation invalidated");
    if (androidVerificationTimerRef.current) {
      clearTimeout(androidVerificationTimerRef.current);
      androidVerificationTimerRef.current = null;
    }
    androidCandidateRef.current = null;
    if (managerRef.current) {
      managerRef.current.setTTSPlaying(false);
    }
    if (activeTtsSessionRef.current) {
      activeTtsSessionRef.current.cancel();
      activeTtsSessionRef.current = null;
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.fastStop();
    }
    setSession((prev) => {
      console.log(`[VOXFLOW-E2E] [SESSION] state -> ${prev.state === "speaking" ? "idle" : prev.state} (cancelled)`);
      return {
        ...prev,
        state: prev.state === "speaking" ? "idle" : prev.state,
        audioLevels: { ...prev.audioLevels, outputLevel: 0 },
      };
    });
  }, []);

  // Instant Full-Duplex Interruption / Barge-in Handler
  const handleBargeIn = useCallback(() => {
    const interruptStart = performance.now();
    isGeneratingRef.current = false;
    console.log("[VOXFLOW-E2E] [BARGE-IN] interruption triggered by user speech");

    // 1. Immediately fast-stop active speech playback
    cancelCurrentSpeech();

    // 2. Abort ongoing Gemini reasoning
    if (conversationManagerRef.current) {
      conversationManagerRef.current.abortCurrent();
    }

    // 3. Mark in-flight assistant message as interrupted
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const list = [...prev];
      const lastIdx = list.length - 1;
      if (list[lastIdx].role === "assistant") {
        list[lastIdx] = {
          ...list[lastIdx],
          interrupted: true,
          isPartial: false,
        };
      }
      return list;
    });

    // 4. Reset hysteresis & claim turn on voice manager
    if (managerRef.current) {
      managerRef.current.onBargeInTriggered();
      managerRef.current.setHysteresis(1.0);
    }
    activeUserMsgIdRef.current = null;
    setCurrentPartialTranscript("");

    // 5. Measure and record cutoff latency
    telemetryRef.current.interruptionCutoffMs = performance.now() - interruptStart;

    // 6. Instantly switch session to listening
    console.log("[VOXFLOW-E2E] [SESSION] state -> interrupted -> listening");
    setSession((prev) => ({
      ...prev,
      state: "listening",
      isSessionActive: true,
      errorMessage: null,
      audioLevels: { ...prev.audioLevels, outputLevel: 0 },
    }));
  }, [cancelCurrentSpeech]);

  // Send conversation history to Gemini and pipeline into Rime TTS
  const triggerGeminiResponse = useCallback(
    async (allMessages: TranscriptMessage[], customRequestId?: string) => {
      if (!conversationManagerRef.current) return;

      if (isGeneratingRef.current) {
        console.warn("[CHAT] Generation already in progress; ignoring duplicate trigger");
        return;
      }

      // Filter out partial messages and extract non-empty turns
      const validHistory: AIChatMessage[] = allMessages
        .filter((m) => !m.isPartial && m.content.trim().length > 0)
        .map((m) => ({
          role: m.role,
          content: m.content.trim(),
        }));

      if (validHistory.length === 0) {
        setSession((prev) => ({ ...prev, state: "idle" }));
        return;
      }

      isGeneratingRef.current = true;
      const requestId =
        customRequestId || `req-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

      // Cancel any older active speech turn before starting a new one
      cancelCurrentSpeech();

      // Set thinking state
      console.log(`[VOXFLOW-E2E] [SESSION] state -> thinking: requestId=${requestId}`);
      setSession((prev) => ({
        ...prev,
        state: "thinking",
        errorMessage: null,
      }));

      telemetryRef.current.geminiStarted = Date.now();
      console.log(`[CHAT] start requestId=${requestId} turns=${validHistory.length}`);
      console.log("[VOXFLOW-MIC] I. GEMINI request started", {
        requestId,
        finalTranscript: validHistory[validHistory.length - 1]?.content,
        timestamp: Date.now(),
      });

      let assistantMsgId: string | null = null;
      let previousTextLength = 0;

      try {
        await conversationManagerRef.current.generateResponse(
          validHistory,
          {
            onChunk: (accumulatedText, genId) => {
              if (!telemetryRef.current.firstGeminiText) {
                telemetryRef.current.firstGeminiText = Date.now();
                console.log("[VOXFLOW-MIC] I. GEMINI response started", { timestamp: Date.now() });
              }

              // 1. Initialize TTSSession on first chunk if not yet created
              if (!activeTtsSessionRef.current && audioPlayerRef.current) {
                telemetryRef.current.firstRimeRequest = Date.now();

                const tts = new TTSSession(genId || `gen-${Date.now()}`, audioPlayerRef.current, {
                  onPlayStart: () => {
                    telemetryRef.current.firstPlaybackStarted = Date.now();
                    playbackStartTimeRef.current = Date.now();
                    if (managerRef.current) {
                      managerRef.current.setHysteresis(1.6);
                      managerRef.current.setTTSPlaying(true);
                    }
                    console.log("[VOXFLOW-E2E] [SESSION] state -> speaking");
                    setSession((prev) => ({
                      ...prev,
                      state: "speaking",
                    }));

                    // HANDS-FREE BARGE-IN:
                    // Enable SpeechRecognition barge-in window when assistant starts speaking
                    if (managerRef.current) {
                      managerRef.current.startBargeInListening({
                        deviceId:
                          audioConfig.selectedInputId !== "default"
                            ? audioConfig.selectedInputId
                            : undefined,
                        noiseSuppression: audioConfig.noiseSuppression,
                        echoCancellation: audioConfig.echoCancellation,
                        autoGainControl: audioConfig.autoGainControl,
                      });
                    }
                  },
                  onAudioLevel: (level) => {
                    setSession((prev) => ({
                      ...prev,
                      audioLevels: {
                        ...prev.audioLevels,
                        outputLevel: level,
                      },
                    }));
                  },
                  onPlayEnd: () => {
                    telemetryRef.current.playbackCompleted = Date.now();
                    if (managerRef.current) {
                      managerRef.current.setTTSPlaying(false);
                    }
                    console.log("[VOXFLOW-E2E] [SESSION] state -> playback completed");
                    if (managerRef.current && managerRef.current.isCapturing()) {
                      // Continuous conversational loop: return to listening for next turn (Desktop)
                      managerRef.current.setHysteresis(1.0);
                      console.log("[VOXFLOW-E2E] [SESSION] state -> listening (desktop loop)");
                      setSession((prev) => ({
                        ...prev,
                        state: "listening",
                        isSessionActive: true,
                        audioLevels: { ...prev.audioLevels, outputLevel: 0 },
                      }));
                    } else {
                      // Android: Stop barge-in listening and return safely to idle
                      if (managerRef.current) {
                        managerRef.current.stopBargeInListening();
                      }
                      console.log("[VOXFLOW-E2E] [SESSION] state -> idle (android turn ended)");
                      setSession((prev) => ({
                        ...prev,
                        state: "idle",
                        isSessionActive: false,
                        audioLevels: { ...prev.audioLevels, outputLevel: 0 },
                      }));
                    }
                  },
                  onInterSentenceWindow: (active) => {
                    if (managerRef.current) {
                      if (active) {
                        managerRef.current.startInterruptionListeningWindow(450);
                      } else {
                        managerRef.current.stopInterruptionListeningWindow();
                      }
                    }
                  },
                  onError: (err) => {
                    console.warn("[VoiceSession] Rime playback notice:", err.message);
                    // Non-blocking notice; preserve active speech and text display
                  },
                });

                activeTtsSessionRef.current = tts;
              }

              // 2. Feed text delta into sentence segmenter
              const delta = accumulatedText.slice(previousTextLength);
              previousTextLength = accumulatedText.length;

              if (activeTtsSessionRef.current && delta) {
                activeTtsSessionRef.current.appendTextChunk(delta);
              }

              // 3. Update Conversation Stream UI with assistant response
              setMessages((prev) => {
                const list = [...prev];
                const currentId = assistantMsgId || `a-${genId}`;
                if (!assistantMsgId) {
                  assistantMsgId = currentId;
                  console.log(`[CHAT] assistant message created: ${currentId} requestId=${requestId}`);
                }

                const idx = list.findIndex((m) => m.id === currentId);
                if (idx !== -1) {
                  list[idx] = {
                    ...list[idx],
                    content: accumulatedText,
                    isPartial: true,
                  };
                  messagesRef.current = list;
                  return list;
                }

                const updated = [
                  ...list,
                  {
                    id: currentId,
                    role: "assistant" as const,
                    content: accumulatedText,
                    timestamp: Date.now(),
                    isPartial: true,
                  },
                ];
                messagesRef.current = updated;
                return updated;
              });
            },
            onDone: (fullText, genId) => {
              isGeneratingRef.current = false;
              console.log(`[CHAT] streamComplete requestId=${requestId} length=${fullText.length}`);
              const currentId = assistantMsgId || `a-${genId}`;
              setMessages((prev) => {
                const updated = prev.map((m) =>
                  m.id === currentId
                    ? { ...m, content: fullText, isPartial: false }
                    : m
                );
                messagesRef.current = updated;
                return updated;
              });

              // CRITICAL: Ensure any trailing text slice is dispatched to TTS before completeText()
              const trailingDelta = fullText.slice(previousTextLength);
              if (activeTtsSessionRef.current) {
                if (trailingDelta) {
                  console.log(`[VOXFLOW-E2E] [SEGMENTER] appending trailing delta to TTS: length=${trailingDelta.length}`);
                  activeTtsSessionRef.current.appendTextChunk(trailingDelta);
                }
                activeTtsSessionRef.current.completeText();
              } else if (audioPlayerRef.current && fullText.trim()) {
                console.log(`[VOXFLOW-E2E] [TTS] initializing TTS session in onDone for full text: length=${fullText.length}`);
                const tts = new TTSSession(genId || `gen-${Date.now()}`, audioPlayerRef.current, {
                  onPlayStart: () => {
                    telemetryRef.current.firstPlaybackStarted = Date.now();
                    playbackStartTimeRef.current = Date.now();
                    if (managerRef.current) {
                      managerRef.current.setHysteresis(1.6);
                      managerRef.current.setTTSPlaying(true);
                    }
                    console.log("[VOXFLOW-E2E] [SESSION] state -> speaking");
                    setSession((prev) => ({
                      ...prev,
                      state: "speaking",
                    }));
                    if (managerRef.current) {
                      managerRef.current.startBargeInListening({
                        deviceId:
                          audioConfig.selectedInputId !== "default"
                            ? audioConfig.selectedInputId
                            : undefined,
                        noiseSuppression: audioConfig.noiseSuppression,
                        echoCancellation: audioConfig.echoCancellation,
                        autoGainControl: audioConfig.autoGainControl,
                      });
                    }
                  },
                  onAudioLevel: (level) => {
                    setSession((prev) => ({
                      ...prev,
                      audioLevels: {
                        ...prev.audioLevels,
                        outputLevel: level,
                      },
                    }));
                  },
                  onPlayEnd: () => {
                    telemetryRef.current.playbackCompleted = Date.now();
                    if (managerRef.current) {
                      managerRef.current.setTTSPlaying(false);
                    }
                    console.log("[VOXFLOW-E2E] [SESSION] state -> playback completed");
                    if (managerRef.current && managerRef.current.isCapturing()) {
                      managerRef.current.setHysteresis(1.0);
                      console.log("[VOXFLOW-E2E] [SESSION] state -> listening (desktop loop)");
                      setSession((prev) => ({
                        ...prev,
                        state: "listening",
                        isSessionActive: true,
                        audioLevels: { ...prev.audioLevels, outputLevel: 0 },
                      }));
                    } else {
                      if (managerRef.current) {
                        managerRef.current.stopBargeInListening();
                      }
                      console.log("[VOXFLOW-E2E] [SESSION] state -> idle (android turn ended)");
                      setSession((prev) => ({
                        ...prev,
                        state: "idle",
                        isSessionActive: false,
                        audioLevels: { ...prev.audioLevels, outputLevel: 0 },
                      }));
                    }
                  },
                  onInterSentenceWindow: (active) => {
                    if (managerRef.current) {
                      if (active) {
                        managerRef.current.startInterruptionListeningWindow(450);
                      } else {
                        managerRef.current.stopInterruptionListeningWindow();
                      }
                    }
                  },
                  onError: (err) => {
                    console.warn("[VoiceSession] Rime playback notice:", err.message);
                  },
                });
                activeTtsSessionRef.current = tts;
                tts.appendTextChunk(fullText);
                tts.completeText();
              } else {
                // If no speech session was initiated, return to idle
                console.log("[VOXFLOW-E2E] [SESSION] state -> idle (no text to speak)");
                setSession((prev) => ({
                  ...prev,
                  state: "idle",
                  isSessionActive: false,
                }));
              }
            },
            onError: (err) => {
              isGeneratingRef.current = false;
              console.error(`[CHAT] response error requestId=${requestId}:`, err);
              cancelCurrentSpeech();

              const cleanMsg =
                err.status === 429
                  ? "AI service is temporarily busy. Please try again shortly."
                  : err.message || "VOXFLOW couldn't process that request.";

              console.log("[VOXFLOW-E2E] [SESSION] state -> error:", cleanMsg);
              setSession((prev) => ({
                ...prev,
                state: "idle",
                isSessionActive: false,
                errorMessage: cleanMsg,
              }));

              // If partial text was received, finalize it; otherwise don't leave broken state
              if (assistantMsgId) {
                setMessages((prev) => {
                  const updated = prev.map((m) =>
                    m.id === assistantMsgId ? { ...m, isPartial: false } : m
                  );
                  messagesRef.current = updated;
                  return updated;
                });
              }
            },
          },
          { requestId }
        );
      } catch {
        // Error handled via onError callback
      } finally {
        isGeneratingRef.current = false;
      }
    },
    [cancelCurrentSpeech]
  );

  const triggerGeminiResponseRef = useRef(triggerGeminiResponse);
  triggerGeminiResponseRef.current = triggerGeminiResponse;

  const handleBargeInRef = useRef(handleBargeIn);
  handleBargeInRef.current = handleBargeIn;

  const cancelCurrentSpeechRef = useRef(cancelCurrentSpeech);
  cancelCurrentSpeechRef.current = cancelCurrentSpeech;

  // Initialize VoiceInputManager, ConversationManager, and AudioPlayer once on mount
  useEffect(() => {
    const voiceManager = new VoiceInputManager({
      energyThreshold: 0.035,
      silenceThresholdMs: 1400,
      minSpeechDurationMs: 80,
    });
    managerRef.current = voiceManager;

    const convManager = new ConversationManager();
    conversationManagerRef.current = convManager;

    // Single persistent audio player
    const player = new AudioPlayer({
      onItemEnded: (item) => {
        if (activeTtsSessionRef.current) {
          activeTtsSessionRef.current.onAudioItemEnded(item);
        }
      },
      onAudioLevel: (level) => {
        setSession((prev) => ({
          ...prev,
          audioLevels: {
            ...prev.audioLevels,
            outputLevel: level,
          },
        }));
      },
    });
    audioPlayerRef.current = player;

    // Register voice input event listeners
    const unbindStart = voiceManager.on("startListening", () => {
      // If Rime is speaking or Gemini is thinking, cancel it upon new input
      cancelCurrentSpeechRef.current();
      convManager.abortCurrent();
      activeUserMsgIdRef.current = null;
      setCurrentPartialTranscript("");
      console.log("[VOXFLOW-E2E] [SESSION] state -> listening");
      setSession((prev) => ({
        ...prev,
        state: "listening",
        isSessionActive: true,
        errorMessage: null,
      }));
    });

    const unbindLevel = voiceManager.on("audioLevel", (level) => {
      setSession((prev) => ({
        ...prev,
        audioLevels: {
          ...prev.audioLevels,
          inputLevel: level,
        },
      }));
    });

    const unbindSpeechStart = voiceManager.on("speechStart", () => {
      console.log("[VOXFLOW-E2E] [STT] speechStart", { timestamp: Date.now() });
      setSession((prev) => ({
        ...prev,
        isSpeaking: true,
      }));

      const isSpeaking = sessionStateRef.current === "speaking";

      // BARGE-IN SAFETY:
      // While the assistant is actively speaking through device speakers, raw audio energy
      // (VAD / onspeechstart) is triggered by the speaker audio itself (acoustic echo).
      // Therefore, raw speechStart MUST NOT interrupt playback.
      // Interruption is exclusively triggered when actual USER words are transcribed in unbindTranscript.
      console.log("[VOXFLOW-BARGE]", {
        assistantSpeaking: isSpeaking,
        speechDetected: true,
        interruptionTriggered: false,
        reason: isSpeaking
          ? "Acoustic activity detected during assistant playback; ignored to prevent self-interruption. Waiting for user speech transcript."
          : "speechStart during non-speaking state",
        timestamp: Date.now(),
      });
    });

    const unbindSpeechEnd = voiceManager.on("speechEnd", () => {
      setSession((prev) => ({
        ...prev,
        isSpeaking: false,
      }));
    });

    const unbindTranscript = voiceManager.on("transcript", (chunk: TranscriptChunk) => {
      const text = chunk.text.trim();
      if (!text) return;

      const isSpeaking = sessionStateRef.current === "speaking";
      console.log("[VOXFLOW-BARGE]", {
        assistantSpeaking: isSpeaking,
        speechDetected: true,
        interruptionTriggered: isSpeaking,
        reason: isSpeaking
          ? `transcript detected while assistant speaking: "${text}"`
          : `transcript received: "${text}"`,
        timestamp: Date.now(),
      });

      console.log("[VOXFLOW-MIC] H. TRANSCRIPT:", {
        isFinal: chunk.isFinal,
        text,
        timestamp: Date.now(),
      });

      if (!chunk.isFinal) {
        console.log("[VOXFLOW-E2E] [STT] interim transcript:", { text, timestamp: Date.now() });
      } else {
        console.log("[VOXFLOW-E2E] [STT] final transcript:", { text, timestamp: Date.now() });
      }

      const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

      // Barge-in validation
      if (isSpeaking) {
        if (!isAndroid) {
          // Desktop: 100% full-duplex with hardware echo cancellation (UNCHANGED)
          console.log("[VOXFLOW-BARGEIN] transcript detected while assistant speaking -> stopping Rime immediately:", text);
          console.log("[VOXFLOW-E2E] [BARGE-IN] speech detected while speaking, triggering interruption:", text);
          handleBargeInRef.current();
        } else {
          // Android: Validate candidate echo vs genuine user speech
          if (!chunk.isCandidate) {
            // Arrived during silent INTERRUPTION_LISTENING window: 100% genuine user speech
            console.log("[VOXFLOW-ANDROID-ECHO] acceptedInterruption", {
              timestamp: Date.now(),
              currentState: "INTERRUPTION_LISTENING",
              ttsPlaying: false,
              recognitionState: "running",
              transcript: text,
              accepted: true,
              reason: "Interruption received during silent inter-sentence window",
            });
            handleBargeInRef.current();
          } else {
            // Candidate received while TTS audio is playing: verify against acoustic echo
            console.log("[VOXFLOW-ANDROID-ECHO] candidateInterruption", {
              timestamp: Date.now(),
              currentState: "SPEAKING",
              ttsPlaying: true,
              recognitionState: "running",
              transcript: text,
              reason: "Transcript received during active TTS playback; performing acoustic silence verification",
            });

            // If we are already verifying a candidate and user continuation speech arrives
            if (androidCandidateRef.current && !androidCandidateRef.current.confirmed) {
              androidCandidateRef.current.confirmed = true;
              if (androidVerificationTimerRef.current) {
                clearTimeout(androidVerificationTimerRef.current);
                androidVerificationTimerRef.current = null;
              }
              console.log("[VOXFLOW-ANDROID-ECHO] acceptedInterruption", {
                timestamp: Date.now(),
                currentState: "SPEAKING",
                ttsPlaying: true,
                recognitionState: "running",
                transcript: text,
                accepted: true,
                reason: "Continuation speech confirmed during verification pause",
              });
              androidCandidateRef.current = null;
              handleBargeInRef.current();
            } else {
              // Pause audio to silence the speaker
              if (audioPlayerRef.current) {
                audioPlayerRef.current.pausePlayback();
              }
              androidCandidateRef.current = {
                initialText: text,
                timestamp: Date.now(),
                confirmed: false,
              };

              if (androidVerificationTimerRef.current) {
                clearTimeout(androidVerificationTimerRef.current);
              }

              androidVerificationTimerRef.current = setTimeout(() => {
                androidVerificationTimerRef.current = null;
                const cand = androidCandidateRef.current;
                if (!cand || cand.confirmed) return;

                console.log("[VOXFLOW-ANDROID-ECHO] ignoredSelfCapture", {
                  timestamp: Date.now(),
                  currentState: "SPEAKING",
                  ttsPlaying: true,
                  recognitionState: "running",
                  transcript: cand.initialText,
                  accepted: false,
                  reason: "Acoustic echo ceased immediately upon audio pause; no continuing user speech detected",
                });

                androidCandidateRef.current = null;
                if (audioPlayerRef.current) {
                  audioPlayerRef.current.resumePlayback();
                }
              }, 350);

              // Candidate is awaiting verification: DO NOT emit to UI or trigger response yet
              return;
            }
          }
        }
      }

      if (!chunk.isFinal) {
        // Stream partial transcript to active turn
        setCurrentPartialTranscript(text);

        setMessages((prev) => {
          const list = [...prev];
          if (activeUserMsgIdRef.current) {
            const idx = list.findIndex((m) => m.id === activeUserMsgIdRef.current);
            if (idx !== -1) {
              list[idx] = {
                ...list[idx],
                content: text,
                isPartial: true,
              };
              messagesRef.current = list;
              return list;
            }
          }

          const newId = `u-${Date.now()}`;
          activeUserMsgIdRef.current = newId;
          const updated = [
            ...list,
            {
              id: newId,
              role: "user" as const,
              content: text,
              timestamp: Date.now(),
              isPartial: true,
            },
          ];
          messagesRef.current = updated;
          return updated;
        });
      } else {
        // Final transcript arrived
        setCurrentPartialTranscript("");

        // Deduplication check: prevent duplicate requests for same final utterance
        if (text === lastProcessedTranscriptRef.current) {
          return;
        }
        lastProcessedTranscriptRef.current = text;
        telemetryRef.current.turnFinalized = Date.now();

        const currentMessages = messagesRef.current;
        let nextList: TranscriptMessage[];

        if (activeUserMsgIdRef.current) {
          const targetId = activeUserMsgIdRef.current;
          activeUserMsgIdRef.current = null;
          const idx = currentMessages.findIndex((m) => m.id === targetId);
          if (idx !== -1) {
            nextList = [...currentMessages];
            nextList[idx] = {
              ...nextList[idx],
              content: text,
              isPartial: false,
            };
          } else {
            nextList = [
              ...currentMessages.filter((m) => !m.isPartial),
              {
                id: `u-${Date.now()}`,
                role: "user" as const,
                content: text,
                timestamp: Date.now(),
                isPartial: false,
              },
            ];
          }
        } else {
          // If no active partial message, remove any leftover orphan partial user messages and add this final one
          nextList = [
            ...currentMessages.filter((m) => !m.isPartial),
            {
              id: `u-${Date.now()}`,
              role: "user" as const,
              content: text,
              timestamp: Date.now(),
              isPartial: false,
            },
          ];
        }

        messagesRef.current = nextList;
        setMessages(nextList);

        console.log("[VOICE] final transcript:", text);

        // Keep microphone active for hands-free dialogue, increasing hysteresis during response
        if (managerRef.current) {
          managerRef.current.setHysteresis(1.6);
        }
        const requestId = `req-voice-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        triggerGeminiResponseRef.current(nextList, requestId);
      }
    });

    const unbindError = voiceManager.on("error", (err: VoiceInputError) => {
      setSession((prev) => ({
        ...prev,
        state: "error",
        isSessionActive: false,
        errorMessage: err.message,
        audioLevels: { inputLevel: 0, outputLevel: 0 },
      }));
    });

    const unbindStop = voiceManager.on("stop", () => {
      if (activeUserMsgIdRef.current) {
        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === activeUserMsgIdRef.current ? { ...m, isPartial: false } : m
          );
          messagesRef.current = updated;
          return updated;
        });
        activeUserMsgIdRef.current = null;
      }
      setCurrentPartialTranscript("");

      setSession((prev) => {
        // Don't override thinking or speaking states if stop was triggered by turn completion
        if (prev.state === "thinking" || prev.state === "speaking") {
          return {
            ...prev,
            isSpeaking: false,
            audioLevels: { ...prev.audioLevels, inputLevel: 0 },
          };
        }
        console.log("[VOXFLOW-E2E] [SESSION] state -> idle (stopped)");
        return {
          ...prev,
          state: "idle",
          isSessionActive: false,
          isSpeaking: false,
          audioLevels: { inputLevel: 0, outputLevel: 0 },
        };
      });
    });

    console.log("[VOXFLOW-MIC-DEBUG] voice hook initialized");
    let isCancelled = false;

    // Initial page state remains idle; microphone is only started on explicit user gesture

    // Cleanup on unmount
    return () => {
      isCancelled = true;
      unbindStart();
      unbindLevel();
      unbindSpeechStart();
      unbindSpeechEnd();
      unbindTranscript();
      unbindError();
      unbindStop();
      voiceManager.dispose();
      convManager.abortCurrent();
      player.dispose();
      if (androidVerificationTimerRef.current) {
        clearTimeout(androidVerificationTimerRef.current);
        androidVerificationTimerRef.current = null;
      }
      androidCandidateRef.current = null;
      if (activeTtsSessionRef.current) {
        activeTtsSessionRef.current.cancel();
      }
      managerRef.current = null;
      conversationManagerRef.current = null;
      audioPlayerRef.current = null;
      activeTtsSessionRef.current = null;
    };
  }, []);

  const isStartingRef = useRef<boolean>(false);

  // Start microphone listening (starts SpeechRecognition synchronously on user gesture)
  const startSession = useCallback(() => {
    if (!managerRef.current) return;
    if (isStartingRef.current || managerRef.current.getState() === "listening") return;
    isStartingRef.current = true;

    const tStart = performance.now();
    console.log("[VOXFLOW-MIC] A. MIC CLICK -> startSession()", {
      perfNow: tStart,
      timestamp: Date.now(),
      stateBefore: session.state,
      userActivationIsActive: (navigator as any)?.userActivation?.isActive,
      userActivationHasBeenActive: (navigator as any)?.userActivation?.hasBeenActive,
    });

    try {
      setSession((prev) => ({ ...prev, errorMessage: null }));

      // 1. SYNCHRONOUS: Start speech recognition immediately within the user gesture call stack
      managerRef.current.start({
        deviceId:
          audioConfig.selectedInputId !== "default"
            ? audioConfig.selectedInputId
            : undefined,
        noiseSuppression: audioConfig.noiseSuppression,
        echoCancellation: audioConfig.echoCancellation,
        autoGainControl: audioConfig.autoGainControl,
      });

      // 2. BACKGROUND: Unlock browser audio player concurrently without awaiting
      if (audioPlayerRef.current) {
        audioPlayerRef.current.unlockAudio().catch((err: any) => {
          console.warn("[VOXFLOW-MIC] Audio player unlock notice:", err?.message || err);
        });
      }

      console.log("[VOXFLOW-MIC] B. startSession() dispatched synchronously", {
        perfNow: performance.now(),
        delayMs: performance.now() - tStart,
      });
    } catch (err: any) {
      console.error("[VOXFLOW-MIC] B. startSession() error:", err?.message || err);
    } finally {
      isStartingRef.current = false;
    }
  }, [audioConfig, session.state]);

  // Stop microphone listening
  const stopSession = useCallback(() => {
    if (!managerRef.current) return;
    managerRef.current.stop();
  }, []);

  // Toggle listening session
  const toggleSession = useCallback(() => {
    if (session.state === "listening") {
      stopSession();
    } else if (session.state === "speaking" || session.state === "thinking") {
      // Natural interrupt: cancel active speech and start listening
      handleBargeIn();
      if (managerRef.current?.getState() !== "listening") {
        startSession();
      }
    } else {
      startSession();
    }
  }, [session.state, startSession, stopSession, handleBargeIn]);

  // Manual text submission (as fallback from composer)
  const sendTextMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Prevent duplicate concurrent submissions
      if (isGeneratingRef.current) {
        console.warn("[CHAT] Generation already active; ignoring duplicate submit");
        return;
      }

      // Unlock audio on send click
      if (audioPlayerRef.current) {
        await audioPlayerRef.current.unlockAudio();
      }

      // Cancel previous active speech if user sends a new message
      cancelCurrentSpeech();

      if (conversationManagerRef.current) {
        conversationManagerRef.current.abortCurrent();
      }

      if (managerRef.current && session.state === "listening") {
        managerRef.current.stop();
      }

      const userMsg: TranscriptMessage = {
        id: `u-${Date.now()}`,
        role: "user" as const,
        content: trimmed,
        timestamp: Date.now(),
        isPartial: false,
      };

      const nextMessages = [...messagesRef.current.filter((m) => !m.isPartial), userMsg];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);

      const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      console.log(`[CHAT] typed message submitted requestId=${requestId}:`, trimmed);
      triggerGeminiResponseRef.current(nextMessages, requestId);
    },
    [session.state, cancelCurrentSpeech]
  );

  const clearMessages = useCallback(() => {
    cancelCurrentSpeech();
    if (conversationManagerRef.current) {
      conversationManagerRef.current.abortCurrent();
    }
    setMessages([]);
    activeUserMsgIdRef.current = null;
    setCurrentPartialTranscript("");
    lastProcessedTranscriptRef.current = "";
    setSession((prev) => ({
      ...prev,
      state: "idle",
      isSessionActive: false,
    }));
  }, [cancelCurrentSpeech]);

  const clearError = useCallback(() => {
    setSession((prev) => ({
      ...prev,
      state: "idle",
      errorMessage: null,
    }));
  }, []);

  return {
    session,
    messages,
    currentPartialTranscript,
    audioConfig,
    setAudioConfig,
    startSession,
    stopSession,
    toggleSession,
    cancelCurrentSpeech,
    sendTextMessage,
    clearMessages,
    clearError,
  };
}
