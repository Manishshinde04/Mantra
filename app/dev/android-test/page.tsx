"use client";

import React, { useState, useRef } from "react";

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

  const addLog = (text: string, type: "info" | "success" | "error" | "event" = "info") => {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random()}`,
      time: new Date().toISOString().substring(11, 23),
      text,
      type,
    };
    console.log(`[VOXFLOW-ANDROID] ${text}`);
    setLogs((prev) => [...prev, entry]);
  };

  const clearLogs = () => {
    setLogs([]);
    setTranscript("");
  };

  // Test 1: Isolated SpeechRecognition ONLY
  const runIsolatedSpeechRecognition = () => {
    clearLogs();
    setActiveTest("isolated-sr");
    const t0 = performance.now();

    addLog(`1. TAP: User tap event fired (perfNow=${t0.toFixed(1)}ms, isActive=${(navigator as any)?.userActivation?.isActive})`, "info");
    addLog(`UserAgent: ${navigator.userAgent}`, "info");

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      addLog("ERROR: SpeechRecognition API not found in this browser!", "error");
      setActiveTest(null);
      return;
    }

    addLog(`2. Constructor: Found ${Boolean((window as any).webkitSpeechRecognition) ? "webkitSpeechRecognition" : "SpeechRecognition"}`, "info");

    try {
      const recognizer = new SR();
      recognizerRef.current = recognizer;
      recognizer.continuous = continuous;
      recognizer.interimResults = true;
      recognizer.maxAlternatives = 1;
      recognizer.lang = navigator.language || "en-US";

      addLog(`Config: lang=${recognizer.lang}, continuous=${recognizer.continuous}, interimResults=${recognizer.interimResults}`, "info");

      recognizer.onstart = () => {
        addLog(`CALLBACK: onstart (delay=${(performance.now() - t0).toFixed(1)}ms)`, "event");
      };

      recognizer.onaudiostart = () => {
        addLog(`CALLBACK: onaudiostart (delay=${(performance.now() - t0).toFixed(1)}ms)`, "event");
      };

      recognizer.onsoundstart = () => {
        addLog(`CALLBACK: onsoundstart (delay=${(performance.now() - t0).toFixed(1)}ms)`, "event");
      };

      recognizer.onspeechstart = () => {
        addLog(`CALLBACK: onspeechstart (delay=${(performance.now() - t0).toFixed(1)}ms)`, "event");
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
        addLog(`CALLBACK: onresult -> "${current}" (isFinal=${Boolean(final)})`, "success");
      };

      recognizer.onspeechend = () => {
        addLog(`CALLBACK: onspeechend (delay=${(performance.now() - t0).toFixed(1)}ms)`, "event");
      };

      recognizer.onsoundend = () => {
        addLog(`CALLBACK: onsoundend (delay=${(performance.now() - t0).toFixed(1)}ms)`, "event");
      };

      recognizer.onaudioend = () => {
        addLog(`CALLBACK: onaudioend (delay=${(performance.now() - t0).toFixed(1)}ms)`, "event");
      };

      recognizer.onerror = (event: any) => {
        addLog(`CALLBACK: onerror -> error="${event.error}", message="${event.message || ""}"`, "error");
      };

      recognizer.onend = () => {
        addLog(`CALLBACK: onend (total duration=${(performance.now() - t0).toFixed(1)}ms)`, "info");
        setActiveTest(null);
      };

      addLog(`3. START: Calling recognizer.start() synchronously at t=${(performance.now() - t0).toFixed(1)}ms...`, "info");
      recognizer.start();
      addLog(`4. start() returned synchronously without throwing!`, "success");
    } catch (err: any) {
      addLog(`SYNCHRONOUS EXCEPTION in start(): ${err?.name} - ${err?.message}`, "error");
      setActiveTest(null);
    }
  };

  // Test 2: Isolated getUserMedia ONLY
  const runIsolatedGetUserMedia = async () => {
    clearLogs();
    setActiveTest("isolated-gum");
    const t0 = performance.now();
    addLog(`1. getUserMedia called (isActive=${(navigator as any)?.userActivation?.isActive})`, "info");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      addLog(`2. getUserMedia SUCCESS (delay=${(performance.now() - t0).toFixed(1)}ms)`, "success");
      addLog(`Track: label="${track.label}", readyState="${track.readyState}", enabled=${track.enabled}, muted=${track.muted}`, "info");
      if (track.getSettings) {
        addLog(`Settings: ${JSON.stringify(track.getSettings())}`, "info");
      }
    } catch (err: any) {
      addLog(`getUserMedia FAILED: ${err?.name} - ${err?.message}`, "error");
    } finally {
      setActiveTest(null);
    }
  };

  // Test 3: Concurrent Test (SpeechRecognition + getUserMedia)
  const runConcurrentTest = async () => {
    clearLogs();
    setActiveTest("concurrent");
    const t0 = performance.now();
    addLog(`1. CONCURRENT TEST STARTED`, "info");

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      addLog("SpeechRecognition not supported", "error");
      return;
    }

    try {
      const r = new SR();
      r.continuous = continuous;
      r.interimResults = true;
      r.lang = navigator.language || "en-US";

      r.onstart = () => addLog(`SR onstart`, "event");
      r.onaudiostart = () => addLog(`SR onaudiostart`, "event");
      r.onspeechstart = () => addLog(`SR onspeechstart`, "event");
      r.onresult = (e: any) => {
        const text = e.results[0][0].transcript;
        setTranscript(text);
        addLog(`SR onresult: "${text}"`, "success");
      };
      r.onerror = (e: any) => addLog(`SR onerror: ${e.error}`, "error");
      r.onend = () => addLog(`SR onend`, "info");

      addLog(`Starting SpeechRecognition synchronously...`, "info");
      r.start();

      addLog(`Now concurrently starting getUserMedia...`, "info");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      addLog(`getUserMedia resolved! Track readyState=${stream.getAudioTracks()[0]?.readyState}`, "success");
    } catch (err: any) {
      addLog(`Concurrent test error: ${err?.message}`, "error");
    }
  };

  const stopAll = () => {
    if (recognizerRef.current) {
      try { recognizerRef.current.abort(); } catch {}
      recognizerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setActiveTest(null);
    addLog("Stopped all active sessions.", "info");
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
          Isolated SpeechRecognition & AudioCapture validation for Android Chrome.
        </p>
      </div>

      {/* Control buttons */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <label className="text-xs text-zinc-300 flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={continuous}
              onChange={(e) => setContinuous(e.target.checked)}
              className="rounded"
            />
            <span>continuous: {continuous ? "TRUE (Dictation)" : "FALSE (Single utterance - Standard Android)"}</span>
          </label>
        </div>

        <button
          onClick={runIsolatedSpeechRecognition}
          disabled={activeTest !== null}
          className="w-full py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold text-sm shadow-lg disabled:opacity-50"
        >
          1. TEST ISOLATED SPEECHRECOGNITION ONLY
        </button>

        <button
          onClick={runIsolatedGetUserMedia}
          disabled={activeTest !== null}
          className="w-full py-3 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 font-semibold text-sm shadow-lg disabled:opacity-50"
        >
          2. TEST ISOLATED getUserMedia ONLY
        </button>

        <button
          onClick={runConcurrentTest}
          disabled={activeTest !== null}
          className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold text-sm shadow-lg disabled:opacity-50"
        >
          3. TEST CONCURRENT (SR + getUserMedia)
        </button>

        {activeTest && (
          <button
            onClick={stopAll}
            className="w-full py-2.5 px-4 rounded-xl bg-red-600 font-semibold text-sm shadow-lg"
          >
            STOP TEST
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
            Diagnostic Event Stream ({logs.length})
          </span>
          <div className="flex gap-2">
            <button
              onClick={copyLogs}
              className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300"
            >
              Copy Logs
            </button>
            <button
              onClick={clearLogs}
              className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="space-y-1.5 font-mono text-xs max-h-96 overflow-y-auto">
          {logs.length === 0 ? (
            <div className="text-zinc-600 italic py-4 text-center">
              Tap any test button above on your Android phone to begin.
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
