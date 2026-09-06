"use client";

import React, { useEffect, useCallback } from "react";
import { VoiceState } from "@/types/voice";
import { Mic, MicOff, Square, Zap, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface VoiceControlProps {
  state: VoiceState;
  isSessionActive: boolean;
  isMuted: boolean;
  onStartSession: () => void;
  onEndSession: () => void;
  onInterrupt: () => void;
  onToggleMute: () => void;
  className?: string;
}

export function VoiceControl({
  state,
  isSessionActive,
  isMuted,
  onStartSession,
  onEndSession,
  onInterrupt,
  onToggleMute,
  className,
}: VoiceControlProps) {
  // Global spacebar listener to control voice or interrupt
  const handleGlobalKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if user is typing in an input or textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (!isSessionActive) {
          onStartSession();
        } else if (state === "speaking" || state === "thinking") {
          onInterrupt();
        } else if (state === "listening") {
          onInterrupt();
        }
      }
    },
    [isSessionActive, state, onStartSession, onInterrupt]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-3 sm:gap-4 p-2 select-none",
        className
      )}
    >
      {/* Secondary: Mute / Unmute Button (Active Session Only) */}
      {isSessionActive && (
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
          className={cn(
            "p-3 rounded-full border transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 cursor-pointer",
            isMuted
              ? "bg-red-950/40 border-red-800/60 text-red-300 hover:bg-red-900/50"
              : "bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
          )}
        >
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
      )}

      {/* Primary Interaction Button */}
      {!isSessionActive ? (
        <button
          type="button"
          onClick={onStartSession}
          aria-label="Start voice session"
          className="group relative inline-flex items-center gap-2.5 px-6 py-3 rounded-full bg-zinc-100 text-zinc-950 hover:bg-white text-sm font-medium tracking-tight shadow-[0_2px_16px_rgba(255,255,255,0.1)] hover:shadow-[0_4px_24px_rgba(255,255,255,0.2)] active:scale-98 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 cursor-pointer"
        >
          <Mic className="w-4 h-4 text-zinc-900 transition-transform group-hover:scale-110" />
          <span>Start talking</span>
          <span className="hidden sm:inline-block ml-1 px-1.5 py-0.5 rounded bg-zinc-200/80 text-[10px] uppercase font-mono tracking-wider text-zinc-600">
            Space
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-2.5">
          {/* Interrupt Button (Highlighted during speech) */}
          {(state === "speaking" || state === "thinking") && (
            <button
              type="button"
              onClick={onInterrupt}
              aria-label="Interrupt agent"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 hover:border-zinc-600 text-xs font-medium tracking-tight transition-all duration-150 cursor-pointer active:scale-98"
            >
              <Zap className="w-3.5 h-3.5 text-zinc-400" />
              <span>Interrupt</span>
              <span className="hidden sm:inline-block ml-1 px-1 py-0.2 rounded bg-zinc-800 text-[10px] font-mono text-zinc-400">
                Space
              </span>
            </button>
          )}

          {/* End Session Button */}
          <button
            type="button"
            onClick={onEndSession}
            aria-label="End conversation session"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-zinc-900/90 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 hover:bg-zinc-850 text-xs font-medium tracking-tight transition-all duration-150 cursor-pointer"
          >
            <Square className="w-3.5 h-3.5" />
            <span>End session</span>
          </button>
        </div>
      )}
    </div>
  );
}
