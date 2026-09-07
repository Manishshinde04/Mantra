"use client";

import React, { useState } from "react";
import { useVoiceSession } from "@/hooks/useVoiceSession";
import { TopBar } from "./TopBar";
import { VoiceOrb } from "@/components/voice/VoiceOrb";
import { ConversationView } from "@/components/conversation/ConversationView";
import { Composer } from "@/components/conversation/Composer";
import { SettingsModal } from "@/components/controls/SettingsModal";
import { Mic, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export function SessionView() {
  const {
    session,
    messages,
    currentPartialTranscript,
    audioConfig,
    setAudioConfig,
    startSession,
    stopSession,
    toggleSession,
    sendTextMessage,
    clearMessages,
    clearError,
  } = useVoiceSession();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  React.useEffect(() => {
    console.log("[VOXFLOW-MIC-DEBUG] component mounted");
  }, []);

  const hasMessages = messages.length > 0;

  const handleMicClick = (e?: React.MouseEvent) => {
    console.log("[VOXFLOW-ANDROID] 1. MIC TAP:", {
      timestamp: Date.now(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      platform: typeof navigator !== "undefined" ? (navigator as any).userAgentData?.platform || navigator.platform : "unknown",
      userActivationIsActive: (navigator as any)?.userActivation?.isActive,
      userActivationHasBeenActive: (navigator as any)?.userActivation?.hasBeenActive,
      currentState: session.state,
    });
    console.log("[VOXFLOW-MIC] A. MIC BUTTON CLICK:", {
      timestamp: Date.now(),
      eventType: e?.type || "click",
      userActivationIsActive: (navigator as any)?.userActivation?.isActive,
      userActivationHasBeenActive: (navigator as any)?.userActivation?.hasBeenActive,
      currentState: session.state,
    });
    toggleSession();
  };

  return (
    <main className="relative flex flex-col min-h-screen w-full bg-[#08080a] text-zinc-100 selection:bg-zinc-800">
      {/* Subtle Ambient Radial Glow (Quiet, deep, Apple-like) */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_50%_30%,rgba(255,255,255,0.03),transparent_70%)]" />

      {/* Clean Top Navigation */}
      <TopBar onOpenSettings={() => setIsSettingsOpen(true)} />

      {/* Calm Inline Error Banner */}
      {session.errorMessage && (
        <div className="relative z-30 w-full max-w-lg mx-auto mt-3 px-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-zinc-900/90 border border-white/[0.08] text-xs text-zinc-300 shadow-xl backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-zinc-400 shrink-0" />
              <span>{session.errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                clearError();
                startSession();
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white text-zinc-950 hover:bg-zinc-200 text-[11px] font-medium transition-all cursor-pointer shrink-0"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Experience Container */}
      <div className="relative z-10 flex-1 flex flex-col w-full max-w-3xl mx-auto">
        {!hasMessages ? (
          /* Initial Empty State: Centered Quiet Experience */
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-16 select-none animate-in fade-in duration-500">
            {/* Small Elegant Voice Orb */}
            <div className="mb-7">
              <VoiceOrb
                state={session.state}
                audioLevels={session.audioLevels}
                onClick={handleMicClick}
                size="md"
              />
            </div>

            {/* Large Elegant Greeting */}
            <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-zinc-100 mb-2.5">
              How can I help you?
            </h1>
            <p className="text-sm sm:text-[15px] text-zinc-400 font-light max-w-xs sm:max-w-sm mb-10 leading-normal">
              {session.state === "listening"
                ? "Listening… speak naturally into your microphone."
                : session.state === "thinking"
                ? "Thinking…"
                : session.state === "speaking"
                ? "Speaking… tap the microphone to interrupt."
                : "Tap the microphone and start speaking."}
            </p>

            {/* Floating Circular Microphone Button */}
            <button
              type="button"
              onClick={handleMicClick}
              aria-label={
                session.state === "listening"
                  ? "Stop listening"
                  : session.state === "speaking"
                  ? "Interrupt speaking"
                  : "Start speaking to MANTRA"
              }
              className={cn(
                "group relative flex items-center justify-center w-14 h-14 rounded-full transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/40 shadow-lg",
                session.state === "listening"
                  ? "bg-white text-zinc-950 scale-105 shadow-[0_0_24px_rgba(255,255,255,0.4)] animate-pulse"
                  : session.state === "speaking"
                  ? "bg-zinc-200 text-zinc-950 scale-105 shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                  : session.state === "error"
                  ? "bg-zinc-900 border border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800"
                  : "bg-white text-zinc-950 hover:bg-zinc-100 hover:scale-[1.03] active:scale-[0.96] shadow-[0_4px_24px_rgba(255,255,255,0.12)]"
              )}
            >
              <Mic className="w-5 h-5 transition-transform group-hover:scale-105" />
            </button>
          </div>
        ) : (
          /* Active Conversational View */
          <ConversationView
            messages={messages}
            isSpeaking={session.state === "speaking"}
            outputLevel={session.audioLevels.outputLevel}
          />
        )}
      </div>

      {/* Floating Bottom Composer */}
      <div className="sticky bottom-0 z-20 pb-6 pt-2 bg-gradient-to-t from-[#08080a] via-[#08080a]/90 to-transparent backdrop-blur-[4px]">
        <Composer
          state={session.state}
          partialTranscript={currentPartialTranscript}
          onMicClick={toggleSession}
          onSendMessage={sendTextMessage}
        />
      </div>

      {/* Minimal Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={audioConfig}
        onChangeConfig={setAudioConfig}
        onClearHistory={clearMessages}
        hasMessages={hasMessages}
      />
    </main>
  );
}
