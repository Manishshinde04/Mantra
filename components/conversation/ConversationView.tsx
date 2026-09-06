"use client";

import React, { useRef, useEffect, useState } from "react";
import { TranscriptMessage } from "@/types/conversation";
import { Message } from "./Message";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConversationViewProps {
  messages: TranscriptMessage[];
  isSpeaking?: boolean;
  outputLevel?: number;
  className?: string;
}

export function ConversationView({
  messages,
  isSpeaking = false,
  outputLevel = 0,
  className,
}: ConversationViewProps) {
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const isUserScrolledUpRef = useRef(false);

  // Monitor scroll position to avoid force-scrolling when user reads older history
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    if (distanceFromBottom > 140) {
      isUserScrolledUpRef.current = true;
      setShowScrollBottom(true);
    } else {
      isUserScrolledUpRef.current = false;
      setShowScrollBottom(false);
    }
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    scrollEndRef.current?.scrollIntoView({ behavior });
    setShowScrollBottom(false);
    isUserScrolledUpRef.current = false;
  };

  useEffect(() => {
    if (!isUserScrolledUpRef.current) {
      scrollToBottom("smooth");
    }
  }, [messages]);

  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="relative flex-1 w-full flex flex-col h-full">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        aria-label="Conversation stream"
        className={cn(
          "w-full max-w-3xl mx-auto flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6 pb-32",
          className
        )}
      >
        {messages.map((msg, index) => {
          const isLatest = index === messages.length - 1;
          return (
            <Message
              key={msg.id}
              message={msg}
              isSpeaking={isLatest && isSpeaking}
              outputLevel={isLatest ? outputLevel : 0}
            />
          );
        })}
        <div ref={scrollEndRef} className="h-4" />
      </div>

      {/* Floating Apple-style "Jump to latest" Pill */}
      {showScrollBottom && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-20 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <button
            type="button"
            onClick={() => scrollToBottom("smooth")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900/80 border border-white/[0.1] text-zinc-300 hover:text-white hover:bg-zinc-800/90 text-xs font-normal shadow-lg backdrop-blur-md transition-all cursor-pointer select-none"
          >
            <span>Jump to latest</span>
            <ArrowDown className="w-3.5 h-3.5 text-zinc-400" />
          </button>
        </div>
      )}
    </div>
  );
}
