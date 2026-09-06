"use client";

import React, { useState, useEffect } from "react";
import { AudioConfig, AudioDevice } from "@/types/voice";
import { X, Mic, Trash2, Sliders, ShieldCheck, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AudioConfig;
  onChangeConfig: (newConfig: AudioConfig) => void;
  onClearHistory: () => void;
  hasMessages: boolean;
}

export function SettingsModal({
  isOpen,
  onClose,
  config,
  onChangeConfig,
  onClearHistory,
  hasMessages,
}: SettingsModalProps) {
  const [devices, setDevices] = useState<AudioDevice[]>([
    { deviceId: "default", label: "Default System Microphone" },
    { deviceId: "built-in", label: "Built-in Microphone Array" },
  ]);

  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devs) => {
          const inputs = devs
            .filter((d) => d.kind === "audioinput")
            .map((d, index) => ({
              deviceId: d.deviceId || `mic-${index}`,
              label: d.label || `Microphone ${index + 1}`,
            }));
          if (inputs.length > 0) setDevices(inputs);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-sm bg-[#121216] border border-white/[0.08] rounded-3xl shadow-2xl p-6 text-zinc-200 animate-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-zinc-400" />
            <h2 id="settings-title" className="text-[14px] font-medium text-zinc-100">
              Settings
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="flex items-center justify-center w-7 h-7 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="py-4 space-y-5">
          {/* Microphone Selector */}
          <div className="space-y-1.5">
            <label
              htmlFor="audio-input-select"
              className="text-xs font-normal text-zinc-400 flex items-center gap-1.5"
            >
              <Mic className="w-3.5 h-3.5 text-zinc-500" />
              Microphone Input
            </label>
            <select
              id="audio-input-select"
              value={config.selectedInputId}
              onChange={(e) =>
                onChangeConfig({ ...config, selectedInputId: e.target.value })
              }
              className="w-full bg-[#18181f] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-white/20 cursor-pointer"
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          {/* Voice Model Indicator */}
          <div className="space-y-1.5">
            <label
              htmlFor="voice-persona-select"
              className="text-xs font-normal text-zinc-400 flex items-center gap-1.5"
            >
              <Volume2 className="w-3.5 h-3.5 text-zinc-500" />
              Voice Model (Rime TTS)
            </label>
            <select
              id="voice-persona-select"
              defaultValue="celeste"
              className="w-full bg-[#18181f] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-white/20 cursor-pointer"
            >
              <option value="celeste">Celeste (Warm & natural english)</option>
              <option value="coda">Coda (Ultra-fast response engine)</option>
            </select>
          </div>

          {/* Hardware DSP Toggles */}
          <div className="pt-3 border-t border-white/[0.06] space-y-3.5">
            <span className="text-[11px] uppercase tracking-wider text-zinc-500 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-zinc-500" />
              Audio Processing
            </span>

            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-300 font-normal">Acoustic Echo Cancellation</span>
              <button
                type="button"
                role="switch"
                aria-checked={config.echoCancellation}
                onClick={() =>
                  onChangeConfig({
                    ...config,
                    echoCancellation: !config.echoCancellation,
                  })
                }
                className={cn(
                  "w-9 h-5 rounded-full transition-colors relative cursor-pointer",
                  config.echoCancellation ? "bg-white" : "bg-zinc-800"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform bg-zinc-950 shadow-sm",
                    config.echoCancellation && "translate-x-4"
                  )}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-300 font-normal">Neural Noise Suppression</span>
              <button
                type="button"
                role="switch"
                aria-checked={config.noiseSuppression}
                onClick={() =>
                  onChangeConfig({
                    ...config,
                    noiseSuppression: !config.noiseSuppression,
                  })
                }
                className={cn(
                  "w-9 h-5 rounded-full transition-colors relative cursor-pointer",
                  config.noiseSuppression ? "bg-white" : "bg-zinc-800"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform bg-zinc-950 shadow-sm",
                    config.noiseSuppression && "translate-x-4"
                  )}
                />
              </button>
            </div>
          </div>

          {/* Clear Conversation Action */}
          {hasMessages && (
            <div className="pt-3 border-t border-white/[0.06]">
              <button
                type="button"
                onClick={() => {
                  onClearHistory();
                  onClose();
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06] text-xs text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5 text-zinc-400" />
                <span>Clear Conversation</span>
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="pt-3 border-t border-white/[0.06] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-full bg-white text-zinc-950 hover:bg-zinc-200 text-xs font-medium cursor-pointer transition-all active:scale-95"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
