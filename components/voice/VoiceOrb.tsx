"use client";

import React from "react";
import { VoiceState, AudioLevels } from "@/types/voice";
import { cn } from "@/lib/utils";

interface VoiceOrbProps {
  state: VoiceState;
  audioLevels?: AudioLevels;
  onClick?: () => void;
  size?: "sm" | "md" | "lg";
  className?: string;
  disabled?: boolean;
}

export function VoiceOrb({
  state,
  audioLevels = { inputLevel: 0, outputLevel: 0 },
  onClick,
  size = "md",
  className,
  disabled = false,
}: VoiceOrbProps) {
  // Activity level calculation for subtle physical reaction
  const activeLevel =
    state === "listening"
      ? Math.min(1.0, audioLevels.inputLevel)
      : state === "speaking"
      ? Math.min(1.0, audioLevels.outputLevel)
      : 0;

  const sizeClasses = {
    sm: "w-10 h-10",
    md: "w-16 h-16",
    lg: "w-24 h-24",
  };

  const coreSizeClasses = {
    sm: "w-8 h-8",
    md: "w-12 h-12",
    lg: "w-18 h-18",
  };

  return (
    <div
      className={cn(
        "relative flex items-center justify-center select-none",
        className
      )}
    >
      {/* Outer ambient glow: restrained, calm, Apple-like */}
      <div
        className={cn(
          "absolute rounded-full transition-all duration-700 pointer-events-none blur-xl",
          size === "sm" ? "w-16 h-16" : size === "md" ? "w-28 h-28" : "w-40 h-40",
          state === "idle" && "bg-white/[0.04] scale-95",
          state === "listening" && "bg-emerald-500/[0.12] scale-110",
          state === "thinking" && "bg-zinc-400/[0.08] scale-100 animate-orb-think",
          state === "speaking" && "bg-white/[0.12] scale-115",
          state === "interrupted" && "bg-amber-500/[0.15] scale-100",
          state === "error" && "bg-rose-500/[0.12] scale-95"
        )}
        style={{
          transform: state === "listening" || state === "speaking"
            ? `scale(${1 + activeLevel * 0.15})`
            : undefined,
        }}
      />

      <button
        type="button"
        role="button"
        aria-label={`Voice state: ${state}. Click to toggle.`}
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "relative flex items-center justify-center rounded-full transition-transform duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/40 cursor-pointer",
          sizeClasses[size],
          disabled && "cursor-not-allowed opacity-50"
        )}
        style={{
          transform: `scale(${1 + activeLevel * 0.12})`,
        }}
      >
        {/* Subtle Outer Concentric Ring */}
        <div
          className={cn(
            "absolute inset-0 rounded-full border transition-all duration-300 pointer-events-none",
            state === "idle" && "border-white/[0.08]",
            state === "listening" && "border-emerald-400/30",
            state === "thinking" && "border-zinc-400/20 animate-orb-think",
            state === "speaking" && "border-white/30 shadow-[0_0_16px_rgba(255,255,255,0.12)]",
            state === "interrupted" && "border-amber-400/40",
            state === "error" && "border-rose-400/30"
          )}
        />

        {/* Physical Apple-Style Core Sphere */}
        <div
          className={cn(
            "relative rounded-full flex items-center justify-center transition-all duration-300 overflow-hidden shadow-2xl",
            coreSizeClasses[size],
            "bg-gradient-to-b from-zinc-800 via-[#18181e] to-[#0c0c10] border border-white/[0.12]",
            state === "idle" && "animate-orb-breathe hover:border-white/20",
            state === "listening" && "border-emerald-400/40 shadow-[inset_0_0_14px_rgba(52,199,89,0.15)]",
            state === "thinking" && "animate-orb-think border-zinc-400/30",
            state === "speaking" && "border-white/30 shadow-[inset_0_0_18px_rgba(255,255,255,0.22)]",
            state === "interrupted" && "border-amber-400/40 shadow-[inset_0_0_14px_rgba(255,159,10,0.15)]",
            state === "error" && "border-rose-400/40"
          )}
        >
          {/* Subtle inner reflective light */}
          <div className="absolute top-1 left-1.5 right-1.5 h-1/3 rounded-t-full bg-gradient-to-b from-white/[0.15] to-transparent pointer-events-none" />

          {/* Minimal functional status indicator dot */}
          {state === "listening" && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,199,89,0.8)] animate-pulse" />
          )}
          {state === "interrupted" && (
            <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(255,159,10,0.8)]" />
          )}
          {state === "error" && (
            <span className="w-2 h-2 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(255,69,58,0.8)]" />
          )}
        </div>
      </button>
    </div>
  );
}
