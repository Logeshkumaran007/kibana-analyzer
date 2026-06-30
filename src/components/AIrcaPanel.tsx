import React, { useState, useEffect } from "react";
import { IncidentRCA, HistoricalIncident } from "../types";
import { Sparkles, Terminal, FileDown, Bookmark, History, RotateCcw, AlertTriangle, Copy, Check, HelpCircle, Cpu, Settings, ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface AIrcaPanelProps {
  key?: string;
  logsSample: string;
  contextInfo: {
    namespace: string;
    podName: string;
    containerName: string;
    serviceName: string;
    incidentCategory?: string;
  };
  hasActiveLogs: boolean;
  autoAnalyze?: boolean;
  onResetAutoAnalyze?: () => void;
}

export default function AIrcaPanel({
  logsSample,
  contextInfo,
  hasActiveLogs,
  autoAnalyze = false,
  onResetAutoAnalyze
}: AIrcaPanelProps) {
  const [loading, setLoading] = useState(false);
  const [rca, setRca] = useState<IncidentRCA | null>(null);
  const [historicalMatch, setHistoricalMatch] = useState<{
    matched: HistoricalIncident | null;
    score: number;
    explanation: string;
  } | null>(null);

  const [apiError, setApiError] = useState<string | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);
  const [kbSaved, setKbSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSolution, setShowSolution] = useState<"yes" | "no" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Ollama settings
  const [ollamaUrl, setOllamaUrl] = useState(() => {
    return localStorage.getItem("sre_ollama_url") || "http://192.168.1.202:11434";
  });
  const [ollamaModel, setOllamaModel] = useState(() => {
    return localStorage.getItem("sre_ollama_model") || "";
  });
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsConnected, setModelsConnected] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => { localStorage.setItem("sre_ollama_url", ollamaUrl); }, [ollamaUrl]);
  useEffect(() => { localStorage.setItem("sre_ollama_model", ollamaModel); }, [ollamaModel]);

  // Pull the list of models actually pulled on the configured Ollama instance,
  // so we never hardcode a specific model name that may not exist locally.
  const refreshModels = () => {
    setModelsLoading(true);
    fetch(`/api/ollama-models?ollamaUrl=${encodeURIComponent(ollamaUrl)}`)
      .then((res) => res.json())
      .then((data) => {
        const models: string[] = data.models || [];
        setAvailableModels(models);
        setModelsConnected(Boolean(data.connected));
        setOllamaModel((current) => {
          if (current && models.includes(current)) return current;
          return models[0] || "";
        });
      })
      .catch(() => {
        setAvailableModels([]);
        setModelsConnected(false);
      })
      .finally(() => setModelsLoading(false));
  };

  useEffect(() => {
    refreshModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset state when logs change
  useEffect(() => {
    setRca(null);
    setHistoricalMatch(null);
    setApiError(null);
    setKbSaved(false);
    setCopied(false);
    setShowSolution(null);
  }, [logsSample]);

  useEffect(() => { setShowSolution(null); }, [rca?.id]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      interval = setInterval(() => {
        setLoadingStep((prev) => (prev + 1) % 4);
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const runAnalysis = async () => {
    if (!logsSample) return;
    setLoading(true);
    setApiError(null);
    setRca(null);
    setHistoricalMatch(null);
    setKbSaved(false);
    setLoadingStep(0);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logsSample,
          contextInfo,
          ollamaUrl,
          ollamaModel,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Internal Server Error");
      }

      const rcaData: IncidentRCA = await response.json();
      const normalizedRca: IncidentRCA = {
        id: rcaData.id || `RCA-${Math.floor(100 + Math.random() * 900)}`,
        title: rcaData.title || "Diagnostic Report",
        timestamp: rcaData.timestamp || new Date().toISOString(),
        primaryError: rcaData.primaryError || "No explicit exception string captured in logs.",
        rootCause: rcaData.rootCause || "Underlying cause undetermined.",
        affectedService: rcaData.affectedService || contextInfo.serviceName || "Unknown Service",
        impactAnalysis: rcaData.impactAnalysis || "System impact not fully evaluated.",
        recommendedFix: rcaData.recommendedFix || "Review code logic and container configuration boundaries.",
        confidence: typeof rcaData.confidence === "number" ? rcaData.confidence : 85,
        preventiveActions: Array.isArray(rcaData.preventiveActions) ? rcaData.preventiveActions : [],
        affectedNamespace: contextInfo.namespace || rcaData.affectedNamespace || "default",
        affectedPod: contextInfo.podName || rcaData.affectedPod || "Unknown",
        timeline: Array.isArray(rcaData.timeline) ? rcaData.timeline : [],
      };
      setRca(normalizedRca);

      try {
        const matchResponse = await fetch("/api/match-historical", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentRCA: normalizedRca,
            ollamaUrl,
            ollamaModel,
          }),
        });
        if (matchResponse.ok) {
          const matchData = await matchResponse.json();
          setHistoricalMatch({
            matched: matchData.matched || null,
            score: typeof matchData.score === "number" ? matchData.score : 0,
            explanation: matchData.explanation || "",
          });
        }
      } catch (matchErr) {
        console.warn("Historical knowledge base match failed:", matchErr);
      }
    } catch (err: any) {
      console.error(err);
      setApiError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoAnalyze && logsSample) {
      runAnalysis();
      if (onResetAutoAnalyze) onResetAutoAnalyze();
    }
  }, [autoAnalyze, logsSample]);

  const saveToKnowledgeBase = async () => {
    if (!rca) return;
    try {
      const response = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: rca.title,
          errorPattern: rca.primaryError,
          rootCause: rca.rootCause,
          resolution: rca.recommendedFix,
          severity: rca.confidence > 80 ? "CRITICAL" : "HIGH",
        }),
      });
      if (response.ok) setKbSaved(true);
    } catch (e) {
      console.error("Save failed:", e);
    }
  };

  const downloadMarkdownReport = () => {
    if (!rca) return;
    const mdString = `# Kubernetes Incident RCA Report: ${rca.title}
**Report Code:** ${rca.id}
**Diagnostic Timestamp:** ${new Date(rca.timestamp).toLocaleString()}

---

## 1. Executive Summary
- **Affected Namespace:** \`${rca.affectedNamespace}\`
- **Affected Pod:** \`${rca.affectedPod}\`
- **Diagnostic Confidence:** \`${rca.confidence}%\`
- **Impact Assessment:** ${rca.impactAnalysis}

---

## 2. Deep Root Cause Analysis
### Primary Exception caught:
\`\`\`text
${rca.primaryError}
\`\`\`

### Underlying Cause:
${rca.rootCause}

---

## 3. Chronological Trace Timeline
${rca.timeline?.map((step) => `- **${step.timestamp}** [${step.service}] ${step.event} => **${step.status}**`).join("\n") || "- Timeline details unavailable"}

---

## 4. Recommended Fixes for Engineering
${rca.recommendedFix}

---

## 5. Required Preventive Actions
${rca.preventiveActions.map((task, idx) => `${idx + 1}. [ ] ${task}`).join("\n")}

---
*Report compiled by Ollama Kubernetes SRE Analyzer using model "${ollamaModel || "unknown"}".*
`;
    const blob = new Blob([mdString], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `SRE_RCA_Report_${rca.id}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = () => {
    if (!rca) return;
    navigator.clipboard.writeText(`[RCA Rpt] ${rca.title}\nID: ${rca.id}\nCause: ${rca.rootCause}\nRecommendation: ${rca.recommendedFix}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const loadingMessages = [
    "Spinning up sandboxed SRE diagnostic container...",
    "Scanning Kibana JSON/CSV structures and extracting traces...",
    "Ollama is reasoning over multi-service stack traces...",
    "Matching historical knowledge base profiles & generating report..."
  ];

  const confidenceColor = rca
    ? rca.confidence >= 85 ? "text-emerald-400" : rca.confidence >= 65 ? "text-amber-400" : "text-red-400"
    : "";

  return (
    <div id="ai-rca-anchor" className="relative overflow-hidden rounded-2xl border border-slate-800/60 bg-[#07090f] text-slate-100 shadow-2xl mb-6">
      {/* Ambient glow blobs */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-violet-600/8 blur-[100px]" />
      <div className="pointer-events-none absolute -left-24 bottom-0 h-72 w-72 rounded-full bg-indigo-600/6 blur-[100px]" />

      {/* ── Header bar ── */}
      <div className="relative flex items-center justify-between border-b border-slate-800/70 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/10 shadow-inner">
            <Cpu className="h-4.5 w-4.5 text-violet-400" />
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-white">
              AI Incident Diagnostic & RCA
              <span className="rounded border border-violet-500/25 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-violet-300">
                OLLAMA · LOCAL
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">
              Root Cause Analysis powered by {ollamaModel ? <span className="text-violet-300 font-mono">{ollamaModel}</span> : "your local Ollama instance"} — no cloud required.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Settings toggle */}
          <button
            type="button"
            onClick={() => setSettingsOpen(v => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/60 bg-slate-800/50 px-3 py-1.5 text-[11px] font-mono text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
          >
            <Settings className="h-3.5 w-3.5" />
            Config
            {settingsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>

          {rca && (
            <>
              <button
                type="button"
                onClick={runAnalysis}
                className="flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-600/80 px-3 py-1.5 font-mono text-[11px] font-semibold text-violet-100 transition hover:bg-violet-600"
              >
                <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                Re-analyze
              </button>
              <button
                type="button"
                onClick={() => { setRca(null); setHistoricalMatch(null); }}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 font-mono text-[11px] text-slate-400 transition hover:text-slate-200"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Ollama Config Panel (collapsible) ── */}
      <AnimatePresence>
        {settingsOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden border-b border-slate-800/60"
          >
            <div className="flex flex-col gap-4 bg-slate-900/40 px-6 py-4 sm:flex-row sm:items-end">
              <div className="flex flex-col gap-1.5">
                <label className="font-mono text-[9.5px] font-bold uppercase tracking-widest text-violet-400">
                  Ollama URL
                </label>
                <input
                  type="text"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder="http://192.168.1.202:11434"
                  className="w-56 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-100 placeholder-slate-600 outline-none transition focus:border-violet-500"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="font-mono text-[9.5px] font-bold uppercase tracking-widest text-violet-400">
                  Ollama Model
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                    disabled={availableModels.length === 0}
                    className="w-44 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-100 outline-none transition focus:border-violet-500 disabled:opacity-50"
                  >
                    {availableModels.length === 0 ? (
                      <option value="">No models found</option>
                    ) : (
                      availableModels.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={refreshModels}
                    disabled={modelsLoading}
                    className="rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-[10px] font-mono text-slate-400 transition hover:text-slate-200 disabled:opacity-50"
                  >
                    {modelsLoading ? "…" : "Refresh"}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1 text-[10px] text-slate-500 font-mono leading-relaxed sm:pb-1.5">
                <span className={modelsConnected ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                  {modelsConnected ? "CONNECTED:" : "SETUP:"}
                </span>
                {modelsConnected ? (
                  <span>{availableModels.length} model{availableModels.length === 1 ? "" : "s"} available on this Ollama instance.</span>
                ) : (
                  <>
                    <span>Run <code className="text-slate-300 bg-slate-800 px-1 rounded">ollama serve</code> and pull a model, e.g. <code className="text-violet-400">ollama pull llama3</code>.</span>
                    <span>Set <code className="text-slate-300 bg-slate-800 px-1 rounded">OLLAMA_ORIGINS="*"</code> if running remotely.</span>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main content area ── */}
      <div className="px-6 py-6">
        {loading ? (
          /* ── Loading state ── */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="relative mb-6">
              <div className="h-16 w-16 animate-spin rounded-full border-2 border-violet-500/20 border-t-violet-400" />
              <Cpu className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 animate-pulse text-violet-400" />
            </div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-slate-300 animate-pulse">
              Ollama SRE Agent Reasoning
            </p>
            <p className="mt-3 h-8 max-w-xs font-mono text-[11px] text-slate-500">
              {loadingMessages[loadingStep]}
            </p>
          </div>

        ) : rca ? (
          /* ── Report view ── */
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="space-y-5"
          >
            {/* Report header */}
            <div className="flex flex-col gap-4 rounded-xl border border-slate-800/80 bg-slate-900/40 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-mono text-[9.5px] font-bold uppercase tracking-widest text-slate-500">
                  RCA · {rca.id} &nbsp;·&nbsp; {new Date(rca.timestamp).toLocaleString()}
                  {contextInfo.incidentCategory && (
                    <span className="ml-2 rounded border border-violet-800/50 bg-violet-900/20 px-1.5 py-0.5 text-violet-400">
                      {contextInfo.incidentCategory}
                    </span>
                  )}
                </p>
                <h2 className="mt-1 font-mono text-sm font-semibold text-white">{rca.title}</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {/* Confidence badge */}
                <div className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 font-mono text-xs">
                  <span className="text-slate-500">Confidence</span>
                  <span className={`font-bold ${confidenceColor}`}>{rca.confidence}%</span>
                </div>
                <button onClick={copyToClipboard} className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 font-mono text-xs text-slate-300 transition hover:border-slate-600 hover:text-white">
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-slate-400" />}
                  {copied ? "Copied!" : "Copy Brief"}
                </button>
                <button onClick={downloadMarkdownReport} className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 font-mono text-xs text-slate-300 transition hover:border-slate-600 hover:text-white">
                  <FileDown className="h-3.5 w-3.5 text-slate-400" />
                  Download MD
                </button>
                <button
                  disabled={kbSaved}
                  onClick={saveToKnowledgeBase}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold transition ${
                    kbSaved
                      ? "border-emerald-800/40 bg-emerald-900/20 text-emerald-400"
                      : "border-violet-500/40 bg-violet-600/80 text-white hover:bg-violet-600"
                  }`}
                >
                  <Bookmark className="h-3.5 w-3.5" />
                  {kbSaved ? "Saved to KB" : "Save to KB"}
                </button>
              </div>
            </div>

            {/* Impact chips row */}
            <div className="flex flex-wrap gap-2 font-mono text-[10px]">
              <span className="rounded-full border border-slate-700/60 bg-slate-800/40 px-2.5 py-1 text-slate-400">
                NS: <span className="text-slate-200">{rca.affectedNamespace}</span>
              </span>
              <span className="rounded-full border border-slate-700/60 bg-slate-800/40 px-2.5 py-1 text-slate-400">
                Pod: <span className="text-slate-200">{rca.affectedPod}</span>
              </span>
              <span className="rounded-full border border-slate-700/60 bg-slate-800/40 px-2.5 py-1 text-slate-400">
                Service: <span className="text-slate-200">{rca.affectedService}</span>
              </span>
            </div>

            {/* Two-column layout */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* ── Left column ── */}
              <div className="space-y-4 lg:col-span-8">
                {/* Primary error */}
                <div className="rounded-xl border border-red-900/40 bg-red-950/15 p-4">
                  <p className="mb-1.5 font-mono text-[9.5px] font-bold uppercase tracking-widest text-red-400">
                    ① Root Failure Signature
                  </p>
                  <p className="break-words font-mono text-xs font-semibold leading-relaxed text-red-300">
                    {rca.primaryError}
                  </p>
                </div>

                {/* Root cause */}
                <div>
                  <p className="mb-1.5 font-mono text-[9.5px] font-bold uppercase tracking-widest text-violet-400">
                    ② Underlying Cause Diagnosis
                  </p>
                  <p className="text-xs leading-relaxed text-slate-300">{rca.rootCause}</p>
                </div>

                {/* Impact */}
                <div>
                  <p className="mb-1.5 font-mono text-[9.5px] font-bold uppercase tracking-widest text-violet-400">
                    ③ Impact Analysis
                  </p>
                  <p className="text-xs leading-relaxed text-slate-400">{rca.impactAnalysis}</p>
                </div>

                {/* Solution card */}
                <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-400">
                      <HelpCircle className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[12.5px] font-semibold text-white">Need a step-by-step fix?</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">Request precise production troubleshooting commands from the SRE agent.</p>
                    </div>
                  </div>

                  {showSolution === null && (
                    <div className="flex gap-2.5 pl-11">
                      <button type="button" onClick={() => setShowSolution("yes")}
                        className="rounded-lg bg-violet-600 px-4 py-1.5 font-mono text-xs font-semibold text-white shadow transition hover:bg-violet-500 active:scale-[0.98]">
                        Yes, show solution
                      </button>
                      <button type="button" onClick={() => setShowSolution("no")}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-1.5 font-mono text-xs font-semibold text-slate-300 transition hover:bg-slate-700 active:scale-[0.98]">
                        Skip for now
                      </button>
                    </div>
                  )}

                  {showSolution === "yes" && (
                    <div className="mt-3 space-y-2.5 pl-11">
                      <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-800/40 bg-emerald-900/15 px-3 py-1 font-mono text-[10px] text-emerald-400">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                        RESOLUTION ACTIVE
                      </div>
                      <div className="rounded-lg border border-slate-700 bg-slate-950 p-3.5">
                        <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-300 select-text">
                          {rca.recommendedFix}
                        </p>
                      </div>
                      <button type="button" onClick={() => setShowSolution("no")}
                        className="font-mono text-[10px] text-slate-500 hover:text-slate-400 hover:underline">
                        Hide solution
                      </button>
                    </div>
                  )}

                  {showSolution === "no" && (
                    <div className="mt-3 flex items-center justify-between pl-11">
                      <p className="text-[11px] italic text-slate-500">Resolution hidden.</p>
                      <button type="button" onClick={() => setShowSolution("yes")}
                        className="font-mono text-xs font-semibold text-violet-400 hover:text-violet-300">
                        Show solution →
                      </button>
                    </div>
                  )}
                </div>

                {/* Timeline */}
                {rca.timeline && rca.timeline.length > 0 && (
                  <div>
                    <p className="mb-3 font-mono text-[9.5px] font-bold uppercase tracking-widest text-violet-400">
                      ④ Chronological Request Timeline
                    </p>
                    <div className="space-y-2.5 font-mono text-[10px]">
                      {rca.timeline.map((step, idx) => {
                        const ok = step.status === "SUCCESS";
                        return (
                          <div key={idx} className="relative flex items-start gap-3 pb-1">
                            {idx < rca.timeline!.length - 1 && (
                              <div className="absolute left-[5px] top-4 bottom-0 w-px bg-slate-800" />
                            )}
                            <div className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${ok ? "bg-emerald-400" : "animate-ping bg-red-400"}`} />
                            <div className="flex-1 rounded-lg border border-slate-800/60 bg-slate-900/30 px-3 py-2">
                              <div className="mb-0.5 flex justify-between text-[9px] text-slate-600">
                                <span className="font-bold text-violet-400">{step.service}</span>
                                <span>{step.timestamp}</span>
                              </div>
                              <p className="leading-snug text-slate-300">{step.event}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Right column ── */}
              <div className="space-y-4 lg:col-span-4">
                {/* Preventive checklist */}
                <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-4">
                  <p className="mb-3 font-mono text-[9.5px] font-bold uppercase tracking-widest text-slate-400">
                    Preventive Checklist
                  </p>
                  <div className="space-y-2">
                    {(rca.preventiveActions || []).map((act, i) => (
                      <div key={i} className="flex items-start gap-2.5 text-[11px] text-slate-400">
                        <div className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-slate-700">
                          <span className="font-bold text-[8px] text-violet-400">✓</span>
                        </div>
                        <span className="leading-snug">{act}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* KB Match */}
                <div className="rounded-xl border border-slate-800/60 bg-slate-900/30 p-4">
                  <p className="mb-3 flex items-center gap-1.5 font-mono text-[9.5px] font-bold uppercase tracking-widest text-slate-400">
                    <History className="h-3 w-3 text-violet-400" />
                    Knowledge Base Match
                  </p>

                  {historicalMatch === null ? (
                    <p className="font-mono text-[11px] text-slate-500">Searching SRE history for similar patterns...</p>
                  ) : historicalMatch.matched ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] text-slate-500">{historicalMatch.matched.id}</span>
                        <span className="rounded border border-violet-700/40 bg-violet-900/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-violet-300">
                          {historicalMatch.score}% MATCH
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-white">{historicalMatch.matched.title}</p>
                      <p className="text-[11px] leading-relaxed text-slate-400">{historicalMatch.explanation}</p>
                      <div className="border-t border-slate-800 pt-2.5">
                        <p className="mb-1 font-mono text-[9px] uppercase tracking-wide text-emerald-400">Past Resolution</p>
                        <p className="font-mono text-[11px] leading-relaxed text-slate-300">{historicalMatch.matched.resolution}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="font-mono text-[11px] text-slate-500">
                      {historicalMatch.explanation || "No closely matching past incidents in the SRE knowledge base."}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </motion.div>

        ) : (
          /* ── Empty / trigger state ── */
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/20 p-10 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700/60 bg-slate-800/40">
              <Terminal className="h-6 w-6 text-slate-600" />
            </div>
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-slate-400">
              Kubernetes SRE Diagnostic
            </p>
            <p className="mt-2 max-w-md font-mono text-[11px] leading-relaxed text-slate-500">
              {hasActiveLogs
                ? logsSample
                  ? contextInfo.incidentCategory
                    ? `Ready to analyze ${logsSample.split("\n").length} log lines for: "${contextInfo.incidentCategory}".`
                    : `Ready to analyze ${logsSample.split("\n").length} selected log entries.`
                  : "Select an incident group, pod error, or specific log lines above to load them into the analyzer."
                : "Drop Kibana logs or select a prepackaged SRE scenario demo below to begin."}
            </p>

            {logsSample && (
              <motion.button
                type="button"
                onClick={runAnalysis}
                whileTap={{ scale: 0.97 }}
                className="mt-5 flex items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-600 px-6 py-2.5 font-mono text-xs font-semibold text-white shadow-lg shadow-violet-900/30 transition hover:bg-violet-500"
              >
                <Sparkles className="h-4 w-4 animate-pulse text-violet-200" />
                Run Ollama RCA Analysis
              </motion.button>
            )}

            {apiError && (
              <div className="mt-4 flex max-w-lg items-start gap-2.5 rounded-xl border border-red-900/50 bg-red-950/20 p-3.5 text-left font-mono text-xs">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
                <div>
                  <p className="mb-1 font-bold text-red-400">Analysis failed: {apiError}</p>
                  <p className="text-[10.5px] leading-relaxed text-slate-400 opacity-80">
                    Ensure Ollama is running at <code className="text-violet-300">{ollamaUrl}</code> with model <code className="text-violet-300">{ollamaModel}</code> pulled.
                    Run: <code className="text-slate-300 bg-slate-900 px-1 rounded">ollama pull {ollamaModel}</code>
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
