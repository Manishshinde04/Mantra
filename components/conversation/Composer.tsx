"use client";

import React, { useState } from "react";
import { VoiceState } from "@/types/voice";
import { Mic, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface ComposerProps {
  state: VoiceState;
  partialTranscript?: string;
  onMicClick: () => void;
  onSendMessage: (text: string) => void;
  className?: string;
}

export function Composer({
  state,
  partialTranscript,
  onMicClick,
  onSendMessage,
  className,
}: ComposerProps) {
  const [inputVal, setInputVal] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim() || state === "thinking") return;
    onSendMessage(inputVal);
    setInputVal("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const getPlaceholder = () => {
    switch (state) {
      case "listening":
        return partialTranscript || "Listening… speak naturally";
      case "thinking":
        return "Thinking…";
      case "speaking":
        return "Speaking… tap mic to interrupt";
      case "error":
        return "Microphone notice. Tap mic to retry…";
      case "idle":
      default:
        return "Tap the microphone to start speaking or type a message…";
    }
  };

  const hasText = inputVal.trim().length > 0;

  return (
    <div className={cn("w-full max-w-2xl mx-auto px-4 sm:px-0", className)}>
      <form
        onSubmit={handleSubmit}
        className={cn(
          "relative flex items-center gap-2.5 px-3 py-2 rounded-full bg-zinc-900/80 border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-200 focus-within:border-white/[0.18] focus-within:bg-zinc-900/95",
          state === "listening" && "border-emerald-500/40 shadow-[0_0_24px_rgba(52,199,89,0.08)]",
          state === "speaking" && "border-white/[0.15]",
          state === "error" && "border-rose-500/40"
        )}
      >
        {/* Floating Circular Microphone Button */}
        <button
          type="button"
          onClick={(e) => {
            console.log("[VOXFLOW-MIC] A. MIC BUTTON CLICK (Composer):", {
              timestamp: Date.now(),
              eventType: e.type,
              userActivationIsActive: (navigator as any)?.userActivation?.isActive,
              userActivationHasBeenActive: (navigator as any)?.userActivation?.hasBeenActive,
              currentState: state,
            });
            onMicClick();
          }}
          aria-label={
            state === "listening"
              ? "Stop listening"
              : state === "speaking"
              ? "Interrupt assistant speech"
              : "Start speaking"
          }
          className={cn(
            "relative flex items-center justify-center w-9 h-9 rounded-full transition-all duration-200 focus:outline-none cursor-pointer shrink-0",
            state === "listening"
              ? "bg-white text-zinc-950 scale-105 shadow-[0_0_16px_rgba(255,255,255,0.4)] animate-pulse"
              : state === "speaking"
              ? "bg-zinc-200 text-zinc-950 hover:bg-white shadow-[0_0_12px_rgba(255,255,255,0.2)]"
              : state === "error"
              ? "bg-rose-950/60 text-rose-300 border border-rose-800/80 hover:bg-rose-900/70"
              : "bg-zinc-800/80 text-zinc-300 hover:text-white hover:bg-zinc-700/80 hover:scale-[1.02] active:scale-[0.96]"
          )}
        >
          <Mic className="w-4 h-4" />
        </button>

        {/* Dynamic Input / Transcript Field */}
        <input
          type="text"
          value={state === "listening" && partialTranscript ? partialTranscript : inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={getPlaceholder()}
          disabled={state === "thinking"}
          className={cn(
            "flex-1 bg-transparent text-[14.5px] placeholder:text-zinc-500 focus:outline-none disabled:cursor-not-allowed tracking-normal font-normal",
            state === "listening" && partialTranscript
              ? "text-zinc-100 font-medium"
              : "text-zinc-100"
          )}
        />

        {/* Apple-style Send Action Button (Appears when text is present) */}
        {hasText && (
          <button
            type="submit"
            disabled={state === "thinking"}
            aria-label="Send message"
            className="flex items-center justify-center w-8 h-8 rounded-full bg-white text-zinc-950 hover:bg-zinc-200 active:scale-95 transition-all duration-150 focus:outline-none cursor-pointer shrink-0 animate-in fade-in zoom-in-75 duration-150 shadow-sm"
          >
            <ArrowUp className="w-4 h-4 stroke-[2.5]" />
          </button>
        )}
      </form>
    </div>
  );
}
