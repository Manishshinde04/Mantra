"use client";

import React from "react";
import { Settings } from "lucide-react";

interface TopBarProps {
  onOpenSettings: () => void;
}

export function TopBar({ onOpenSettings }: TopBarProps) {
  return (
    <header className="w-full max-w-4xl mx-auto px-6 py-5 flex items-center justify-between border-b border-white/[0.04] bg-[#08080a]/80 backdrop-blur-lg select-none sticky top-0 z-30 transition-all">
      {/* Refined Apple-style Brand Header */}
      <div className="flex flex-col">
        <span className="text-[15px] font-semibold tracking-wider text-zinc-100 uppercase">
          MANTRA
        </span>
        <span className="text-[11px] text-zinc-500 font-normal tracking-normal">
          Realtime Voice Agent
        </span>
      </div>

      {/* Top-Right: Minimal Quiet Settings Icon */}
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Settings"
        className="flex items-center justify-center w-8 h-8 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-all duration-200 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400/40"
      >
        <Settings className="w-4 h-4 stroke-[1.75]" />
      </button>
    </header>
  );
}
