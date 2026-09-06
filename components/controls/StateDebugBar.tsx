"use client";

import React, { useState } from "react";
import { VoiceState } from "@/types/voice";
import { ChevronUp, ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface StateDebugBarProps {
  currentState: VoiceState;
  onSelectState: (state: VoiceState) => void;
}

const STATES: VoiceState[] = [
  "idle",
  "listening",
  "thinking",
  "speaking",
  "interrupted",
];

export function StateDebugBar({
  currentState,
  onSelectState,
}: StateDebugBarProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <aside
      aria-label="State Preview Controller"
      className="fixed bottom-3 right-3 z-40"
    >
      <div className="bg-[#111115]/90 border border-zinc-800/90 rounded-xl shadow-xl backdrop-blur-md overflow-hidden transition-all duration-200">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/60 text-zinc-500 gap-3">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="w-3 h-3 text-zinc-400" />
            <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400">
              State Preview
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-label={isExpanded ? "Collapse state preview" : "Expand state preview"}
            className="p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {isExpanded && (
          <div className="p-2 flex items-center gap-1.5">
            {STATES.map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => onSelectState(st)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[11px] font-mono capitalize transition-all duration-150 cursor-pointer",
                  currentState === st
                    ? "bg-zinc-200 text-zinc-950 font-semibold shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                )}
              >
                {st}
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
