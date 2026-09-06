"use client";

import React from "react";
import { VoiceState } from "@/types/voice";
import { cn } from "@/lib/utils";

interface VoiceStatusProps {
  state: VoiceState;
  className?: string;
}

export function VoiceStatus({ state, className }: VoiceStatusProps) {
  const getStatusContent = () => {
    switch (state) {
      case "idle":
        return {
          title: "Ready",
          subtitle: "Tap the orb or press Space to start talking",
          badgeColor: "bg-zinc-500",
        };
      case "listening":
        return {
          title: "Listening",
          subtitle: "Speak naturally, audio streaming active",
          badgeColor: "bg-emerald-400/90 shadow-[0_0_8px_rgba(52,211,153,0.4)]",
        };
      case "thinking":
        return {
          title: "Thinking",
          subtitle: "Synthesizing response...",
          badgeColor: "bg-zinc-300 animate-pulse",
        };
      case "speaking":
        return {
          title: "Speaking",
          subtitle: "Tap orb or press Space to interrupt",
          badgeColor: "bg-zinc-100 shadow-[0_0_8px_rgba(255,255,255,0.6)]",
        };
      case "interrupted":
        return {
          title: "Interrupted",
          subtitle: "Catching your voice...",
          badgeColor: "bg-amber-400/90",
        };
      case "error":
      default:
        return {
          title: "Microphone Error",
          subtitle: "Tap microphone to retry access",
          badgeColor: "bg-red-400/90",
        };
    }
  };

  const { title, subtitle, badgeColor } = getStatusContent();

  return (
    <div className={cn("flex flex-col items-center text-center space-y-1.5", className)}>
      {/* Realtime Status Badge */}
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/80 border border-zinc-800/80 backdrop-blur-sm">
        <span className={cn("w-1.5 h-1.5 rounded-full transition-all duration-300", badgeColor)} />
        <span className="text-xs font-medium tracking-wide uppercase text-zinc-300">
          {title}
        </span>
      </div>

      {/* Subtitle / Contextual Guidance */}
      <p className="text-xs sm:text-sm text-zinc-500 tracking-normal font-normal max-w-sm transition-opacity duration-200">
        {subtitle}
      </p>
    </div>
  );
}
