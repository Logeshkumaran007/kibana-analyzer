import React, { useState, useEffect } from "react";
import { LogEntry, DashboardStats } from "./types";
import { parseLogs } from "./utils/logParser";
import LogUploadArea from "./components/LogUploadArea";
import MetricCards from "./components/MetricCards";
import ErrorExplorer from "./components/ErrorExplorer";
import TraceFlow from "./components/TraceFlow";
import AIrcaPanel from "./components/AIrcaPanel";
import RawLogViewer from "./components/RawLogViewer";
import WelcomeScreen from "./components/WelcomeScreen";
import { Terminal, Cpu, Activity, ChevronLeft, ChevronRight, UploadCloud, LayoutGrid, FileSearch2, GitBranch, Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

function getDiverseLogSample(parsedLogs: LogEntry[]): string {
  const errors = parsedLogs.filter((l) => l.logLevel === "ERROR" || l.logLevel === "FATAL" || l.logLevel === "CRITICAL" || l.exceptionType);
  if (errors.length === 0) {
    return parsedLogs.slice(0, 30).map((e) => `[${e.timestamp}] [${e.logLevel}] [${e.podName || "host"}] ${e.errorMessage}`).join("\n");
  }

  const categoryKeywords: { [key: string]: string[] } = {
    "Redis Connectivity": ["redis", "sentinel", "jedis", "lettuce", "redisconnection"],
    "Elasticsearch Failures": ["elasticsearch", "index", "shards", "cluster_block_exception", "bulk_request"],
    "JVM / GC Memory": ["outofmemoryerror", "metaspace", "java.lang.outofmemoryerror", "g1 young generation", "gc overhead"],
    "Kafka Messaging": ["kafka", "producer", "consumer", "broker", "bootstrap.servers", "disconnect"],
    "Postgres Database": ["postgresql", "psqlexception", "hikari", "database", "connection refused", "port 5432"],
    "API / Gateway Timeouts": ["gateway", "timeout", "upstream", "504", "deadline_exceeded", "context deadline exceeded"],
    "Pod CrashLoopBackOff": ["crashloopbackoff", "backoff", "restarting", "exit code 137", "oomkilled", "exit code 1"],
    "Auto-Scaling / HPA": ["hpa", "horizontalpodautoscaler", "metrics", "scale", "cpu utilization", "replicas"],
    "Image Registry / Pull": ["imagepullbackoff", "errimagepull", "failed pulling image", "registry.scalezee.com"],
    "SSL / TLS Certificates": ["ssl", "certificate", " expired", "handshake", "trustmanager", "pkix"],
    "Nginx Ingress / Proxies": ["ingress", "nginx.ingress", "502 bad gateway", "too big header", "proxy-buffer", "504 gateway timeout"]
  };

  const selectedEntries: LogEntry[] = [];
  const matchedSet = new Set<LogEntry>();

  for (const [_, keywords] of Object.entries(categoryKeywords)) {
    const catLogs = errors.filter(e => keywords.some(kw => e.errorMessage.toLowerCase().includes(kw)));
    if (catLogs.length > 0) {
      selectedEntries.push(...catLogs.slice(0, 3));
      catLogs.forEach(e => matchedSet.add(e));
    }
  }

  const unmatched = errors.filter(e => !matchedSet.has(e));
  if (unmatched.length > 0) {
    selectedEntries.push(...unmatched.slice(0, 5));
  }

  if (selectedEntries.length < 20) {
    const existingIds = new Set(selectedEntries.map(e => e.lineNumber));
    for (const err of errors) {
      if (!existingIds.has(err.lineNumber)) {
        selectedEntries.push(err);
        existingIds.add(err.lineNumber);
        if (selectedEntries.length >= 30) break;
      }
    }
  }

  selectedEntries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const uniqueSelected = Array.from(new Set(selectedEntries));
  return uniqueSelected.slice(0, 40).map((e) => `[${e.timestamp}] [${e.logLevel}] [${e.podName || "host"}] ${e.errorMessage}`).join("\n");
}

export default function App() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedLineNumber, setSelectedLineNumber] = useState<number | null>(null);
  const [stats, setStats] = useState<DashboardStats>({
    namespacesCount: 0,
    podsCount: 0,
    errorsCount: 0,
    warningsCount: 0,
    traceIdsCount: 0,
    logsCount: 0,
  });

  const [aiLogsSample, setAiLogsSample] = useState("");
  const [aiContext, setAiContext] = useState<{
    namespace: string;
    podName: string;
    containerName: string;
    serviceName: string;
    incidentCategory?: string;
  }>({
    namespace: "",
    podName: "",
    containerName: "",
    serviceName: "",
    incidentCategory: "",
  });

  const [isApiConfigured, setIsApiConfigured] = useState(false);
  const [uploadToken, setUploadToken] = useState(0);
  const [aiSessionId, setAiSessionId] = useState(0);
  const [autoAnalyze, setAutoAnalyze] = useState(false);

  // ---- Multi-step wizard state ----
  const [activeStep, setActiveStep] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);

  const STEPS = [
    { id: "import", label: "Import Source", short: "Import", icon: UploadCloud, desc: "Select log source" },
    { id: "explore", label: "Namespace & Incidents", short: "Explore", icon: LayoutGrid, desc: "Inventory & failures" },
    { id: "console", label: "Raw Log Console", short: "Console", icon: FileSearch2, desc: "Line-by-line browser" },
    { id: "rca", label: "Trace & RCA", short: "Trace/RCA", icon: GitBranch, desc: "AI root cause" },
  ];

  const goToStep = (idx: number) => {
    if (idx < 0 || idx >= STEPS.length) return;
    if (idx > 0 && logs.length === 0) return; // gate beyond import until logs exist
    setActiveStep(idx);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Check Ollama connectivity status on mount
  useEffect(() => {
    fetch("/api/ollama-models")
      .then((res) => res.json())
      .then((data) => {
        setIsApiConfigured(Boolean(data.connected && data.models && data.models.length > 0));
      })
      .catch((e) => {
        console.warn("Could not reach backend health checks. Falling back to local routing simulation.", e);
      });
  }, []);

  const handleLogsLoaded = (logText: string, format: "csv" | "json" | "raw") => {
    const parsed = parseLogs(logText, format);
    setLogs(parsed);
    setSelectedLineNumber(null);
    setUploadToken((prev) => prev + 1);
    setAiSessionId((prev) => prev + 1);
    setAutoAnalyze(false);

    // Compute stats
    const uniqueNamespaces = Array.from(new Set(parsed.map((l) => l.namespace))).filter(Boolean);
    const uniquePods = Array.from(new Set(parsed.map((l) => l.podName))).filter(Boolean);
    const errors = parsed.filter((l) => l.logLevel === "ERROR" || l.logLevel === "FATAL");
    const warnings = parsed.filter((l) => l.logLevel === "WARN" || l.logLevel === "WARNING");
    const traceIds = Array.from(new Set(parsed.map((l) => l.traceId))).filter(Boolean);

    setStats({
      namespacesCount: uniqueNamespaces.length,
      podsCount: uniquePods.length,
      errorsCount: errors.length,
      warningsCount: warnings.length,
      traceIdsCount: traceIds.length,
      logsCount: parsed.length,
    });

    // Automatically load diverse error sample across all categories for instant global AI analysis
    if (errors.length > 0) {
      const sampleLogs = getDiverseLogSample(parsed);
      setAiLogsSample(sampleLogs);
      setAiContext({
        namespace: errors[0].namespace,
        podName: errors[0].podName,
        containerName: errors[0].containerName,
        serviceName: errors[0].serviceName,
        incidentCategory: "All Discovered Failures",
      });
    } else if (parsed.length > 0) {
      const sampleLogs = parsed.slice(0, 20).map((e) => `[${e.timestamp}] [${e.logLevel}] [${e.podName || "host"}] ${e.errorMessage}`).join("\n");
      setAiLogsSample(sampleLogs);
      setAiContext({
        namespace: parsed[0].namespace || "observability",
        podName: parsed[0].podName || "86c847d5c",
        containerName: parsed[0].containerName || "system-agent",
        serviceName: parsed[0].serviceName || "kubernetes",
      });
    } else {
      setAiLogsSample("");
    }

    // Auto-advance the wizard into the exploration step once data is ready
    setActiveStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSelectSample = (sampleMsg: string, context: typeof aiContext, shouldAutoAnalyze: boolean = true) => {
    setAiLogsSample(sampleMsg);
    setAiContext(context);
    setAiSessionId((prev) => prev + 1);
    setAutoAnalyze(shouldAutoAnalyze);
  };

  if (!hasStarted) {
    return <WelcomeScreen onStart={() => setHasStarted(true)} />;
  }

  return (
    <div className="min-h-screen bg-[#04060d] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.18),rgba(255,255,255,0))] text-slate-300 font-sans selection:bg-indigo-600 selection:text-white transition-colors duration-200">
      
      {/* Top Professional SRE Header */}
      <header className="h-16 border-b border-[#1b253b]/60 bg-[#04060d]/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto h-full px-6 flex items-center justify-between gap-4">
          <div
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => setHasStarted(false)}
            title="Back to start"
          >
            <div className="w-8 h-8 bg-gradient-to-tr from-indigo-600 to-violet-600 rounded flex items-center justify-center text-white shadow-[0_0_12px_rgba(99,102,241,0.3)]">
              <Terminal className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-extrabold tracking-tight text-white bg-gradient-to-r from-white via-[#e2e8f0] to-[#94a3b8] bg-clip-text text-transparent">
                KIBANA <span className="text-indigo-400">ANALYZER</span>
              </h1>
            </div>
          </div>

          {/* SRE Console Badges */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* AI Connectivity badge */}
            <div
              className={`flex items-center gap-1.5 border px-3 py-1.5 rounded text-xs font-semibold ${
                isApiConfigured
                  ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/30"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/20"
              }`}
            >
              <Activity className={`h-3.5 w-3.5 ${isApiConfigured ? "animate-pulse text-indigo-400" : "text-amber-400"}`} />
              <span>{isApiConfigured ? "Ollama: Connected" : "Ollama: Not Reachable"}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Step Wizard Progress Bar */}
      <div className="border-b border-[#1b253b]/60 bg-[#06080e]/70 backdrop-blur-md sticky top-16 z-30">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
            {STEPS.map((step, idx) => {
              const isActive = idx === activeStep;
              const isComplete = idx < activeStep || (idx === 0 && logs.length > 0);
              const isLocked = idx > 0 && logs.length === 0;
              return (
                <React.Fragment key={step.id}>
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => goToStep(idx)}
                    className={`group flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition-all shrink-0 ${
                      isActive
                        ? "bg-indigo-500/15 border border-indigo-500/40 shadow-[0_0_14px_rgba(99,102,241,0.18)]"
                        : isLocked
                        ? "border border-transparent opacity-40 cursor-not-allowed"
                        : "border border-transparent hover:bg-slate-900/40 cursor-pointer"
                    }`}
                  >
                    <div
                      className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold border ${
                        isActive
                          ? "bg-gradient-to-tr from-indigo-600 to-violet-600 text-white border-indigo-400/60"
                          : isComplete
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40"
                          : "bg-[#0B0E14] text-slate-500 border-slate-800"
                      }`}
                    >
                      {isComplete && !isActive ? <Check className="h-3 w-3" /> : idx + 1}
                    </div>
                    <div className="text-left hidden sm:block">
                      <p className={`text-[11px] font-bold tracking-tight leading-none ${isActive ? "text-white" : isComplete ? "text-slate-300" : "text-slate-500"}`}>
                        {step.label}
                      </p>
                      <p className="text-[9.5px] text-slate-500 font-mono leading-none mt-1">{step.desc}</p>
                    </div>
                    <span className={`sm:hidden text-[10.5px] font-bold ${isActive ? "text-white" : "text-slate-500"}`}>{step.short}</span>
                  </button>
                  {idx < STEPS.length - 1 && (
                    <div className={`h-px flex-1 min-w-[16px] ${idx < activeStep ? "bg-indigo-500/40" : "bg-slate-800"}`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Container body */}
      <main className="max-w-7xl mx-auto px-6 py-6">

        <AnimatePresence mode="wait">

          {/* ================= STEP 1: IMPORT SOURCE (dropdown segment) ================= */}
          {activeStep === 0 && (
            <motion.div
              key="step-import"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
            >
              {/* Upload / Paste Panel */}
              <LogUploadArea onLogsLoaded={handleLogsLoaded} />

              {/* Helper instructions */}
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="border border-slate-800 bg-[#0D1117] rounded-xl p-8 text-center max-w-3xl mx-auto mt-6 shadow-2xl flex flex-col items-center"
              >
                <div className="bg-[#0B0E14] border border-slate-800 p-4 rounded-full mb-4">
                  <Cpu className="h-9 w-9 text-indigo-400" />
                </div>
                <h2 className="text-lg font-semibold text-white tracking-tight">
                  Ready to automate Kubernetes diagnostics?
                </h2>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed max-w-md">
                  SRE analysis consumes hours of log hunting across multiple microservice boundaries. Connect logs, trace requests, categorize errors into clusters, and query your local Ollama model for direct diagnoses instantly.
                </p>

                <div className="w-full mt-8 text-left bg-[#0B0E14] p-5 rounded-xl border border-slate-800">
                  <div className="space-y-1.5">
                    <span className="font-bold text-[10.5px] text-indigo-400 uppercase tracking-widest block">
                      How to start analysis
                    </span>
                    <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
                      1. Export log entries (CSV, JSON, NDJSON) from Kibana, Elasticsearch, or OpenShift master dashboards.<br />
                      2. Drag and drop the log file or paste raw console lines into the import console.<br />
                      3. The wizard auto-advances to namespace &amp; incident exploration once parsing completes.
                    </p>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}

          {/* ================= STEP 2: NAMESPACE / POD / INCIDENT EXPLORER ================= */}
          {activeStep === 1 && logs.length > 0 && (
            <motion.div
              key="step-explore"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="space-y-8"
            >
              {/* Stat indicators */}
              <MetricCards stats={stats} />

              {/* Category Explorer Grid */}
              <ErrorExplorer
                logs={logs}
                onSelectSample={handleSelectSample}
                selectedLineNumber={selectedLineNumber}
                onSelectLineNumber={(line) => {
                  setSelectedLineNumber(line);
                  setActiveStep(2);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            </motion.div>
          )}

          {/* ================= STEP 3: ORIGINAL LOG FILE CONSOLE ================= */}
          {activeStep === 2 && logs.length > 0 && (
            <motion.div
              key="step-console"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="space-y-6"
            >
              <div className="bg-gradient-to-br from-[#0e1324] via-[#090b11] to-[#05070a] border border-[#1b253b]/60 rounded-xl px-5 py-4 shadow-xl flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
                  <FileSearch2 className="h-4 w-4 text-indigo-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm tracking-tight">
                    Original Log File Console — Line-by-Line Browser
                  </h3>
                  <p className="text-[11px] text-slate-500 font-mono">
                    Inspect raw lines from the uploaded export file. Selected errors map directly to their index.
                  </p>
                </div>
              </div>

              {/* Original Log File Console Viewer */}
              <RawLogViewer
                logs={logs}
                selectedLineNumber={selectedLineNumber}
                onSelectLineNumber={setSelectedLineNumber}
              />
            </motion.div>
          )}

          {/* ================= STEP 4: TRACE FLOW + AI RCA ================= */}
          {activeStep === 3 && logs.length > 0 && (
            <motion.div
              key="step-rca"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.25 }}
              className="space-y-8"
            >
              {/* Tracing Timeline flowcharts */}
              <TraceFlow logs={logs} />

              {/* AI analysis control desk */}
              <div id="ai-rca-anchor">
                <AIrcaPanel
                  key={`rca-panel-${aiSessionId}`}
                  logsSample={aiLogsSample}
                  contextInfo={aiContext}
                  hasActiveLogs={logs.length > 0}
                  autoAnalyze={autoAnalyze}
                  onResetAutoAnalyze={() => setAutoAnalyze(false)}
                />
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        {/* Wizard Prev / Next Footer Navigation */}
        {logs.length > 0 && (
          <div className="flex items-center justify-between mt-10 pt-6 border-t border-slate-800/60">
            <button
              type="button"
              onClick={() => goToStep(activeStep - 1)}
              disabled={activeStep === 0}
              className="flex items-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-lg border border-slate-800 text-slate-400 hover:text-white hover:border-slate-600 transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:border-slate-800"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </button>

            <div className="flex items-center gap-1.5">
              {STEPS.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => goToStep(idx)}
                  className={`h-1.5 rounded-full transition-all ${
                    idx === activeStep ? "w-6 bg-indigo-500" : "w-1.5 bg-slate-700 hover:bg-slate-600"
                  }`}
                />
              ))}
            </div>

            {activeStep === STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setHasStarted(false)}
                className="flex items-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-lg border border-slate-800 text-slate-400 hover:text-white hover:border-slate-600 transition-all"
              >
                Start Over
              </button>
            ) : (
              <button
                type="button"
                onClick={() => goToStep(activeStep + 1)}
                className="flex items-center gap-1.5 text-xs font-bold px-4 py-2.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white transition-all shadow-md"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </main>

      {/* SRE Footer branding block */}
      <footer className="border-t border-slate-800 bg-[#0B0E14] mt-24 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-400 tracking-tight text-[11px]">
              Kibana Analyzer
            </span>
          </div>
          <p className="font-mono text-[10px] text-slate-600">
            Platform built-in safe local sandbox environment
          </p>
        </div>
      </footer>

    </div>
  );
}
