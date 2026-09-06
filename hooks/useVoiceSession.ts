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

  // Cancel any active Rime speech, playback, and queued audio
  const cancelCurrentSpeech = useCallback(() => {
    isGeneratingRef.current = false;
    if (activeTtsSessionRef.current) {
      activeTtsSessionRef.current.cancel();
      activeTtsSessionRef.current = null;
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.fastStop();
    }
    setSession((prev) => ({
      ...prev,
      state: prev.state === "speaking" ? "idle" : prev.state,
      audioLevels: { ...prev.audioLevels, outputLevel: 0 },
    }));
  }, []);

  // Instant Full-Duplex Interruption / Barge-in Handler
  const handleBargeIn = useCallback(() => {
    const interruptStart = performance.now();
    isGeneratingRef.current = false;

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

    // 4. Reset hysteresis & clear active user utterance buffer
    if (managerRef.current) {
      managerRef.current.setHysteresis(1.0);
    }
    activeUserMsgIdRef.current = null;
    setCurrentPartialTranscript("");

    // 5. Measure and record cutoff latency
    telemetryRef.current.interruptionCutoffMs = performance.now() - interruptStart;

    // 6. Instantly switch session to listening
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
      setSession((prev) => ({
        ...prev,
        state: "thinking",
        errorMessage: null,
      }));

      telemetryRef.current.geminiStarted = Date.now();
      console.log(`[CHAT] start requestId=${requestId} turns=${validHistory.length}`);

      let assistantMsgId: string | null = null;
      let previousTextLength = 0;

      try {
        await conversationManagerRef.current.generateResponse(
          validHistory,
          {
            onChunk: (accumulatedText, genId) => {
              if (!telemetryRef.current.firstGeminiText) {
                telemetryRef.current.firstGeminiText = Date.now();
              }

              // 1. Initialize TTSSession on first chunk if not yet created
              if (!activeTtsSessionRef.current && audioPlayerRef.current) {
                telemetryRef.current.firstRimeRequest = Date.now();

                const tts = new TTSSession(genId || `gen-${Date.now()}`, audioPlayerRef.current, {
                  onPlayStart: () => {
                    telemetryRef.current.firstPlaybackStarted = Date.now();
                    if (managerRef.current) {
                      managerRef.current.setHysteresis(1.6);
                    }
                    setSession((prev) => ({
                      ...prev,
                      state: "speaking",
                    }));
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
                    if (managerRef.current && managerRef.current.isCapturing()) {
                      // Continuous conversational loop: return to listening for next turn
                      managerRef.current.setHysteresis(1.0);
                      setSession((prev) => ({
                        ...prev,
                        state: "listening",
                        isSessionActive: true,
                        audioLevels: { ...prev.audioLevels, outputLevel: 0 },
                      }));
                    } else {
                      setSession((prev) => ({
                        ...prev,
                        state: "idle",
                        isSessionActive: false,
                        audioLevels: { ...prev.audioLevels, outputLevel: 0 },
                      }));
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

              // Flush remaining buffered text into Rime synthesis
              if (activeTtsSessionRef.current) {
                activeTtsSessionRef.current.completeText();
              } else {
                // If no speech session was initiated, return to idle
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
      setSession((prev) => ({
        ...prev,
        isSpeaking: true,
      }));

      // Full-duplex barge-in: Only interrupt when assistant is actively SPEAKING audio.
      // Do NOT abort during 'thinking' because trailing prompt breath or room noise would kill the Gemini request!
      if (sessionStateRef.current === "speaking") {
        handleBargeInRef.current();
      }
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

      // Full-duplex barge-in: Only interrupt when assistant is actively SPEAKING audio.
      if (sessionStateRef.current === "speaking") {
        handleBargeInRef.current();
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

    // Check browser microphone permission and initialize immediately if granted (or prompt)
    const checkPermissionAndAutoStart = async () => {
      // Yield slightly to ensure React hydration and initial render commit
      await new Promise((resolve) => setTimeout(resolve, 60));
      if (isCancelled || !managerRef.current) return;

      try {
        if (typeof navigator !== "undefined" && navigator.permissions?.query) {
          try {
            const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
            if (status.state === "denied") {
              console.log("[VOXFLOW-MIC-DEBUG] permission status = denied");
              return;
            }
          } catch {
            // Permissions query for microphone name not supported on all platforms; proceed
          }
        }

        if (!isCancelled && managerRef.current && managerRef.current.getState() !== "listening") {
          console.log("[VOXFLOW-MIC-DEBUG] startListening called (auto-start on mount)");
          await managerRef.current.start({
            deviceId:
              audioConfig.selectedInputId !== "default"
                ? audioConfig.selectedInputId
                : undefined,
            noiseSuppression: audioConfig.noiseSuppression,
            echoCancellation: audioConfig.echoCancellation,
            autoGainControl: audioConfig.autoGainControl,
          });
        }
      } catch {
        // Errors are routed to manager's error event listener
      }
    };

    checkPermissionAndAutoStart();

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

  // Start microphone listening (unlocks audio context simultaneously)
  const startSession = useCallback(async () => {
    if (!managerRef.current) return;
    if (isStartingRef.current || managerRef.current.getState() === "listening") return;
    isStartingRef.current = true;
    console.log("[VOXFLOW-MIC-DEBUG] startListening called (user action)");
    try {
      setSession((prev) => ({ ...prev, errorMessage: null }));

      // Unlock browser audio context during this explicit user click gesture
      if (audioPlayerRef.current) {
        await audioPlayerRef.current.unlockAudio();
      }

      await managerRef.current.start({
        deviceId:
          audioConfig.selectedInputId !== "default"
            ? audioConfig.selectedInputId
            : undefined,
        noiseSuppression: audioConfig.noiseSuppression,
        echoCancellation: audioConfig.echoCancellation,
        autoGainControl: audioConfig.autoGainControl,
      });
    } catch {
      // Error handled via event listener
    } finally {
      isStartingRef.current = false;
    }
  }, [audioConfig]);

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
