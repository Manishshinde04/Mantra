"use client";

import React, { useState, useRef } from "react";
import { VoiceInputManager } from "@/voice/VoiceInputManager";

interface LogEntry {
  id: string;
  time: string;
  text: string;
  type: "info" | "success" | "error" | "event";
}

export default function AndroidTestPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTest, setActiveTest] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [continuous, setContinuous] = useState<boolean>(false);
  const recognizerRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const voxflowManagerRef = useRef<VoiceInputManager | null>(null);

  const addLog = (
    text: string,
    type: "info" | "success" | "error" | "event" = "info",
    extra?: any
  ) => {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random()}`,
      time: new Date().toISOString().substring(11, 23),
      text,
      type,
    };
    if (extra !== undefined) {
      console.log(`[ANDROID-STT] ${text}`, extra);
    } else {
      console.log(`[ANDROID-STT] ${text}`);
    }
    setLogs((prev) => [...prev, entry]);
  };

  const clearLogs = () => {
    setLogs([]);
    setTranscript("");
  };

  // TEST A: Isolated SpeechRecognition ONLY
  // USER TAP -> new webkitSpeechRecognition() -> recognition.start() IMMEDIATELY
  // NO getUserMedia, NO AudioContext, NO VAD, NO AudioPlayer, NO Gemini, NO Rime
  const runIsolatedSpeechRecognition = () => {
    stopAll();
    clearLogs();
    setActiveTest("TEST-A");
    const t0 = performance.now();
    const startTimestamp = Date.now();

    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
    const hasStandardSR = typeof window !== "undefined" && Boolean((window as any).SpeechRecognition);
    const hasWebkitSR = typeof window !== "undefined" && Boolean((window as any).webkitSpeechRecognition);
    const userActivationIsActive = typeof navigator !== "undefined" && Boolean((navigator as any)?.userActivation?.isActive);

    addLog(`=== TEST A: ISOLATED SpeechRecognition ===`, "info");
    addLog(`userAgent: ${userAgent}`, "info");
    addLog(`SpeechRecognition availability: ${hasStandardSR}`, "info");
    addLog(`webkitSpeechRecognition availability: ${hasWebkitSR}`, "info");
    addLog(`userActivation.isActive: ${userActivationIsActive}`, "info");

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      addLog("SpeechRecognition API NOT FOUND in this browser!", "error");
      setActiveTest(null);
      return;
    }

    try {
      const recognizer = new SR();
      recognizerRef.current = recognizer;
      recognizer.continuous = continuous;
      recognizer.interimResults = true;
      recognizer.maxAlternatives = 1;
      recognizer.lang = (navigator as any)?.language || "en-US";

      addLog(`Configured recognizer: lang=${recognizer.lang}, continuous=${recognizer.continuous}, interimResults=${recognizer.interimResults}`, "info");

      recognizer.onstart = () => {
        addLog(`onstart fired (delay=${(performance.now() - t0).toFixed(1)}ms)`, "event", { timestamp: Date.now() });
      };

      recognizer.onaudiostart = () => {
        addLog(`onaudiostart fired (delay=${(performance.now() - t0).toFixed(1)}ms)`, "event", { timestamp: Date.now() });
      };

      recognizer.onsoundstart = () => {
        addLog(`onsoundstart fired (delay=${(performance.now() - t0).toFixed(1)}ms)`, "event", { timestamp: Date.now() });
      };

      recognizer.onspeechstart = () => {
        addLog(`onspeechstart fired (delay=${(performance.now() - t0).toFixed(1)}ms)`, "event", { timestamp: Date.now() });
      };

      recognizer.onresult = (event: any) => {
        let interim = "";
        let final = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            final += res[0].transcript;
          } else {
            interim += res[0].transcript;
          }
        }
        const current = final || interim;
        setTranscript(current);
        addLog(`onresult fired: "${current}" (isFinal=${Boolean(final)})`, "success", {
          transcript: current,
          isFinal: Boolean(final),
          resultIndex: event.resultIndex,
          length: event.results.length,
        });
      };

      recognizer.onspeechend = () => {
        addLog(`onspeechend fired`, "event", { timestamp: Date.now() });
      };

      recognizer.onsoundend = () => {
        addLog(`onsoundend fired`, "event", { timestamp: Date.now() });
      };

      recognizer.onaudioend = () => {
        addLog(`onaudioend fired`, "event", { timestamp: Date.now() });
      };

      recognizer.onerror = (event: any) => {
        addLog(`onerror (exact error): "${event.error}", message="${event.message || ""}"`, "error", {
          error: event.error,
          message: event.message,
        });
      };

      recognizer.onend = () => {
        addLog(`onend fired (total session=${(performance.now() - t0).toFixed(1)}ms)`, "info", { timestamp: Date.now() });
        setActiveTest(null);
      };

      addLog(`Calling recognition.start() IMMEDIATELY... (timestamp=${startTimestamp})`, "info");
      recognizer.start();
      addLog(`recognition.start() returned synchronously without throwing!`, "success");
    } catch (err: any) {
      addLog(`SYNCHRONOUS EXCEPTION in start(): ${err?.name} - ${err?.message}`, "error");
      setActiveTest(null);
    }
  };

  // TEST B: SpeechRecognition + getUserMedia CONCURRENTLY
  // USER TAP -> recognition.start() immediately + getUserMedia() separately
  const runSpeechRecognitionPlusGetUserMedia = async () => {
    stopAll();
    clearLogs();
    setActiveTest("TEST-B");
    const t0 = performance.now();

    addLog(`=== TEST B: SpeechRecognition + getUserMedia ===`, "info");
    addLog(`userAgent: ${navigator.userAgent}`, "info");

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      addLog("SpeechRecognition not supported", "error");
      setActiveTest(null);
      return;
    }

    try {
      const recognizer = new SR();
      recognizerRef.current = recognizer;
      recognizer.continuous = continuous;
      recognizer.interimResults = true;
      recognizer.lang = navigator.language || "en-US";

      recognizer.onstart = () => addLog(`onstart fired`, "event");
      recognizer.onaudiostart = () => addLog(`onaudiostart fired`, "event");
      recognizer.onsoundstart = () => addLog(`onsoundstart fired`, "event");
      recognizer.onspeechstart = () => addLog(`onspeechstart fired`, "event");
      recognizer.onresult = (e: any) => {
        const text = e.results[0][0].transcript;
        setTranscript(text);
        addLog(`onresult fired: "${text}"`, "success");
      };
      recognizer.onerror = (e: any) => {
        addLog(`onerror (exact error): "${e.error}", message="${e.message || ""}"`, "error");
      };
      recognizer.onend = () => {
        addLog(`onend fired`, "info");
        setActiveTest(null);
      };

      addLog(`1. Calling recognition.start() IMMEDIATELY...`, "info");
      recognizer.start();
      addLog(`2. recognition.start() initiated successfully`, "success");

      addLog(`3. Now requesting getUserMedia({ audio: true }) concurrently...`, "info");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      addLog(`4. getUserMedia resolved! Track label="${track?.label}", readyState="${track?.readyState}"`, "success");
      addLog(`Speak into microphone now to test if onresult or onerror fires...`, "info");
    } catch (err: any) {
      addLog(`TEST B error: ${err?.name} - ${err?.message}`, "error");
    }
  };

  // TEST C: Complete VOXFLOW pipeline
  const runCompleteVoxflow = () => {
    stopAll();
    clearLogs();
    setActiveTest("TEST-C");

    addLog(`=== TEST C: COMPLETE VOXFLOW PIPELINE ===`, "info");
    addLog(`Instantiating VoiceInputManager...`, "info");

    const manager = new VoiceInputManager();
    voxflowManagerRef.current = manager;

    manager.on("startListening", () => addLog(`VOXFLOW event: startListening`, "event"));
    manager.on("speechStart", () => addLog(`VOXFLOW event: speechStart (VAD detected human voice)`, "event"));
    manager.on("speechEnd", () => addLog(`VOXFLOW event: speechEnd (VAD detected silence boundary)`, "event"));
    manager.on("transcript", (chunk) => {
      setTranscript(chunk.text);
      addLog(`VOXFLOW event: transcript -> "${chunk.text}" (isFinal=${chunk.isFinal})`, "success");
    });
    manager.on("audioLevel", (level) => {
      if (level > 0.15) {
        // throttled log
      }
    });
    manager.on("error", (err) => {
      addLog(`VOXFLOW event: error -> "${err.type}": ${err.message}`, "error");
    });
    manager.on("stop", () => {
      addLog(`VOXFLOW event: stop`, "info");
      setActiveTest(null);
    });

    addLog(`Calling manager.start()...`, "info");
    manager.start();
  };

  const stopAll = () => {
    if (recognizerRef.current) {
      try {
        recognizerRef.current.onend = null;
        recognizerRef.current.onerror = null;
        recognizerRef.current.abort();
      } catch {}
      recognizerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (voxflowManagerRef.current) {
      voxflowManagerRef.current.dispose();
      voxflowManagerRef.current = null;
    }
    setActiveTest(null);
  };

  const copyLogs = () => {
    const text = logs.map((l) => `[${l.time}] ${l.text}`).join("\n");
    navigator.clipboard.writeText(text);
    alert("Logs copied to clipboard!");
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 font-sans max-w-xl mx-auto">
      <div className="border-b border-zinc-800 pb-3 mb-4">
        <h1 className="text-xl font-bold text-amber-400">VOXFLOW — Android Diagnostic Lab</h1>
        <p className="text-xs text-zinc-400 mt-1">
          Android Chrome Root Cause Isolation (Live Diagnostic)
        </p>
      </div>

      {/* Control buttons */}
      <div className="space-y-3 mb-4">
        <div className="flex items-center gap-2 p-2 bg-zinc-900 rounded-lg border border-zinc-800">
          <label className="text-xs text-zinc-300 flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={continuous}
              onChange={(e) => setContinuous(e.target.checked)}
              className="rounded"
            />
            <span>
              continuous: {continuous ? "TRUE (Dictation - triggers Android early exit)" : "FALSE (Single-Utterance - Android Standard)"}
            </span>
          </label>
        </div>

        <button
          onClick={runIsolatedSpeechRecognition}
          disabled={activeTest !== null}
          className="w-full py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 font-bold text-sm shadow-lg disabled:opacity-50 text-left flex justify-between items-center"
        >
          <span>TEST A: Isolated SpeechRecognition ONLY</span>
          <span className="text-xs bg-blue-800 px-2 py-1 rounded">No getUserMedia</span>
        </button>

        <button
          onClick={runSpeechRecognitionPlusGetUserMedia}
          disabled={activeTest !== null}
          className="w-full py-3.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 font-bold text-sm shadow-lg disabled:opacity-50 text-left flex justify-between items-center"
        >
          <span>TEST B: SpeechRecognition + getUserMedia</span>
          <span className="text-xs bg-amber-800 px-2 py-1 rounded">Concurrent Mic</span>
        </button>

        <button
          onClick={runCompleteVoxflow}
          disabled={activeTest !== null}
          className="w-full py-3.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 font-bold text-sm shadow-lg disabled:opacity-50 text-left flex justify-between items-center"
        >
          <span>TEST C: Complete VOXFLOW Pipeline</span>
          <span className="text-xs bg-purple-800 px-2 py-1 rounded">Full Stack</span>
        </button>

        {activeTest && (
          <button
            onClick={stopAll}
            className="w-full py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-500 font-bold text-sm shadow-lg"
          >
            STOP ACTIVE TEST ({activeTest})
          </button>
        )}
      </div>

      {/* Live transcript banner */}
      {transcript && (
        <div className="p-3 mb-4 rounded-xl bg-green-950 border border-green-700">
          <div className="text-xs text-green-300 font-bold uppercase tracking-wider">Live Transcript:</div>
          <div className="text-lg font-bold text-green-100 mt-1">{transcript}</div>
        </div>
      )}

      {/* Live Log Console */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
        <div className="flex justify-between items-center mb-2 pb-2 border-b border-zinc-800">
          <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
            [ANDROID-STT] Event Stream ({logs.length})
          </span>
          <div className="flex gap-2">
            <button
              onClick={copyLogs}
              className="text-xs px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 font-medium"
            >
              Copy Logs
            </button>
            <button
              onClick={clearLogs}
              className="text-xs px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 font-medium"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="space-y-1.5 font-mono text-xs max-h-96 overflow-y-auto">
          {logs.length === 0 ? (
            <div className="text-zinc-600 italic py-4 text-center">
              Tap TEST A, TEST B, or TEST C above on your Android phone to execute.
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className={`p-1.5 rounded ${
                  log.type === "error"
                    ? "bg-red-950/60 text-red-300 border border-red-800/50"
                    : log.type === "success"
                    ? "bg-green-950/60 text-green-300 font-semibold"
                    : log.type === "event"
                    ? "bg-amber-950/40 text-amber-300"
                    : "text-zinc-300"
                }`}
              >
                <span className="text-zinc-500 mr-1.5">[{log.time}]</span>
                {log.text}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
