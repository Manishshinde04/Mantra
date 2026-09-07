"use client";

import React, { useState, useEffect } from "react";
import { TranscriptMessage } from "@/types/conversation";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

interface MessageProps {
  message: TranscriptMessage;
  isSpeaking?: boolean;
  outputLevel?: number;
}

export function Message({ message, isSpeaking = false, outputLevel = 0 }: MessageProps) {
  const isUser = message.role === "user";
  const [formattedTime, setFormattedTime] = useState<string>("");

  // Hydration-safe client-side time formatting
  useEffect(() => {
    try {
      const date = new Date(message.timestamp);
      setFormattedTime(
        date.toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })
      );
    } catch {
      setFormattedTime("");
    }
  }, [message.timestamp]);

  return (
    <div
      className={cn(
        "group w-full flex flex-col py-3 animate-in fade-in duration-300",
        isUser ? "items-end" : "items-start"
      )}
    >
      {/* Header: Role and Metadata */}
      <div className="flex items-center gap-2 mb-1.5 select-none text-xs">
        <span
          className={cn(
            "font-medium tracking-tight",
            isUser ? "text-zinc-400" : "text-zinc-200"
          )}
        >
          {isUser ? "YOU" : "MANTRA"}
        </span>

        {formattedTime && (
          <>
            <span className="text-zinc-600 font-light">·</span>
            <span className="text-zinc-500 font-light" suppressHydrationWarning>
              {formattedTime}
            </span>
          </>
        )}

        {/* Inline Thinking State (Assistant streaming start) */}
        {!isUser && message.isPartial && message.content.trim().length === 0 && (
          <span className="inline-flex items-center gap-1 ml-1 text-zinc-400 font-normal">
            <span className="text-zinc-600">·</span>
            <span>Thinking</span>
            <span className="inline-flex items-center gap-0.5 ml-0.5">
              <span className="w-1 h-1 rounded-full bg-zinc-400 animate-thinking-dot-1" />
              <span className="w-1 h-1 rounded-full bg-zinc-400 animate-thinking-dot-2" />
              <span className="w-1 h-1 rounded-full bg-zinc-400 animate-thinking-dot-3" />
            </span>
          </span>
        )}

        {/* Inline Speaking State Indicator with subtle animated waveform */}
        {!isUser && isSpeaking && !message.interrupted && (
          <span className="inline-flex items-center gap-1.5 ml-1 text-zinc-300 text-[11px] font-normal">
            <span className="text-zinc-600">·</span>
            <span>Speaking</span>
            <span className="inline-flex items-center gap-[2px] h-3 ml-0.5">
              <span
                className="w-[2px] rounded-full bg-zinc-300 transition-all duration-100"
                style={{ height: `${Math.max(3, 4 + outputLevel * 8)}px` }}
              />
              <span
                className="w-[2px] rounded-full bg-zinc-300 transition-all duration-100"
                style={{ height: `${Math.max(4, 6 + outputLevel * 12)}px` }}
              />
              <span
                className="w-[2px] rounded-full bg-zinc-300 transition-all duration-100"
                style={{ height: `${Math.max(3, 3 + outputLevel * 6)}px` }}
              />
            </span>
          </span>
        )}
      </div>

      {/* Message Body */}
      <div
        className={cn(
          "w-full text-[15px] sm:text-[16px] leading-relaxed tracking-normal font-normal",
          isUser
            ? "max-w-xl text-right text-zinc-200 font-light"
            : "max-w-2xl text-left text-zinc-100 space-y-3 font-normal"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap leading-relaxed">
            {message.content}
            {message.isPartial && (
              <span className="inline-block w-1.5 h-3.5 ml-1 bg-zinc-400/80 animate-pulse align-middle rounded-sm" />
            )}
          </p>
        ) : (
          <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-p:text-zinc-200 prose-headings:text-zinc-100 prose-headings:font-medium prose-strong:text-zinc-100 prose-strong:font-medium prose-code:text-zinc-200 prose-code:bg-zinc-900/80 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-xs prose-pre:bg-zinc-900/90 prose-pre:border prose-pre:border-white/[0.06] prose-li:text-zinc-300 prose-ul:my-2 prose-ol:my-2">
            <ReactMarkdown>{message.content}</ReactMarkdown>
            {message.isPartial && (
              <span className="inline-block w-1.5 h-3.5 ml-1 bg-zinc-400/80 animate-pulse align-middle rounded-sm" />
            )}
          </div>
        )}
      </div>

      {/* Inline Native Interruption Event (Phase 13 requirement) */}
      {message.interrupted && (
        <div className="w-full flex items-center justify-start mt-4 mb-2 animate-in fade-in slide-in-from-bottom-1 duration-300 select-none">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/60 border border-white/[0.06] text-[11.5px] text-zinc-400 shadow-sm backdrop-blur-md">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400/90" />
            <span className="font-medium text-zinc-300">Interrupted</span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-400">You interrupted MANTRA</span>
          </div>
        </div>
      )}
    </div>
  );
}
