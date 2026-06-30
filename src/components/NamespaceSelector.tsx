import React, { useState } from "react";
import { LogEntry } from "../types";
import { Server, Cpu, AlertTriangle, ListFilter, Activity, Box, Database, AppWindow } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface NamespaceSelectorProps {
  logs: LogEntry[];
}

export default function NamespaceSelector({ logs }: NamespaceSelectorProps) {
  const [selectedNamespace, setSelectedNamespace] = useState<string | null>(null);
  const [selectedPod, setSelectedPod] = useState<string | null>(null);

  // Group data by namespace
  const namespaces = Array.from(new Set(logs.map((l) => l.namespace))).filter(Boolean);

  const namespaceMetrics = namespaces.map((ns) => {
    const nsLogs = logs.filter((l) => l.namespace === ns);
    const nsPods = Array.from(new Set(nsLogs.map((l) => l.podName))).filter(Boolean);
    const errors = nsLogs.filter((l) => l.logLevel === "ERROR" || l.logLevel === "FATAL");
    const warnings = nsLogs.filter((l) => l.logLevel === "WARN" || l.logLevel === "WARNING");
    const services = Array.from(new Set(nsLogs.map((l) => l.serviceName))).filter(Boolean);

    // Heuristic for critical issues
    const criticalIssues = errors.filter((e) =>
      ["Exception", "OOM", "Timeout", "Crash", "Fail", "Fatal"].some((kw) =>
        e.errorMessage.toLowerCase().includes(kw.toLowerCase())
      )
    ).length;

    return {
      name: ns,
      podsCount: nsPods.length,
      podsList: nsPods,
      errorCount: errors.length,
      warningCount: warnings.length,
      criticalCount: criticalIssues,
      services: services,
    };
  });

  const activeNamespaceData = namespaceMetrics.find((n) => n.name === selectedNamespace);

  // Pod Level Heuristic Extractor
  const podMetrics = logs
    .filter((l) => !selectedNamespace || l.namespace === selectedNamespace)
    .reduce((acc, log) => {
      if (!log.podName) return acc;
      if (!acc[log.podName]) {
        acc[log.podName] = {
          name: log.podName,
          namespace: log.namespace,
          errorCount: 0,
          warnCount: 0,
          restartCount: 0,
          lastFailure: "",
          containers: new Set<string>(),
          healthStatus: "Healthy" as "Healthy" | "Unhealthy" | "Warning",
        };
      }

      const pod = acc[log.podName];
      if (log.logLevel === "ERROR" || log.logLevel === "FATAL") {
        pod.errorCount++;
        pod.lastFailure = log.errorMessage;
      } else if (log.logLevel === "WARN" || log.logLevel === "WARNING") {
        pod.warnCount++;
      }

      if (log.containerName) {
        pod.containers.add(log.containerName);
      }

      // Detect restarts or health status
      const msg = log.errorMessage.toLowerCase();
      if (msg.includes("restart") || msg.includes("restarting") || msg.includes("oomkilled") || msg.includes("exit code 137")) {
        // Find restart count if printed, otherwise default increment
        const match = log.errorMessage.match(/restart count:?\s*(\d+)/i);
        if (match && match[1]) {
          pod.restartCount = Math.max(pod.restartCount, parseInt(match[1]));
        } else {
          pod.restartCount = Math.max(pod.restartCount, 1);
        }
      }

      if (msg.includes("oomkilled") || msg.includes("crashloop") || msg.includes("backoff") || msg.includes("fatal") || msg.includes("failed liveness")) {
        pod.healthStatus = "Unhealthy";
      } else if (pod.healthStatus !== "Unhealthy" && (pod.errorCount > 0 || msg.includes("unhealthy") || msg.includes("liveness probe failed") || msg.includes("warn"))) {
        pod.healthStatus = "Warning";
      }

      return acc;
    }, {} as Record<string, {
      name: string;
      namespace: string;
      errorCount: number;
      warnCount: number;
      restartCount: number;
      lastFailure: string;
      containers: Set<string>;
      healthStatus: "Healthy" | "Unhealthy" | "Warning";
    }>);

  const pods = Object.values(podMetrics);
  const activePodData = selectedPod ? podMetrics[selectedPod] : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
      {/* Namespaces Sidebar (Column width 4) */}
      <div className="lg:col-span-4 bg-gradient-to-br from-[#0e1324] via-[#090b11] to-[#05070a] border border-[#1b253b]/60 rounded-xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4 border-b border-[#1b253b]/60 pb-3">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-indigo-400" />
            <h3 className="font-semibold text-white text-sm tracking-tight">
              Namespace Inventory
            </h3>
          </div>
          <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded font-mono">
            {namespaces.length} Active
          </span>
        </div>

        <div className="space-y-2 max-h-[310px] overflow-y-auto pr-1">
          {namespaceMetrics.map((ns) => {
            const isSelected = selectedNamespace === ns.name;
            return (
              <button
                key={ns.name}
                onClick={() => {
                  setSelectedNamespace(isSelected ? null : ns.name);
                  setSelectedPod(null);
                }}
                className={`w-full text-left p-3 rounded border transition-all flex flex-col gap-1.5 ${
                  isSelected
                    ? "bg-[#0B0E14] border-indigo-500/40"
                    : "border-slate-800 hover:bg-[#0B0E14] hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="font-mono text-xs text-slate-200 break-all pr-2">
                    {ns.name}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {ns.errorCount > 0 && (
                      <span className="text-[9px] bg-red-950/40 text-red-400 border border-red-900/30 px-1.5 py-0.5 rounded font-mono">
                        {ns.errorCount} ERR
                      </span>
                    )}
                    {ns.warningCount > 0 && (
                      <span className="text-[9px] bg-amber-950/40 text-amber-400 border border-amber-900/30 px-1.5 py-0.5 rounded font-mono">
                        {ns.warningCount} WRN
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex justify-between items-center text-[10px] text-slate-500">
                  <span className="font-mono">{ns.podsCount} Pods allocated</span>
                  {ns.criticalCount > 0 && (
                    <span className="text-red-400 flex items-center gap-0.5">
                      <AlertTriangle className="h-3 w-3" />
                      {ns.criticalCount} Critical
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {namespaces.length === 0 && (
            <div className="text-center py-8 text-xs text-slate-500">
              No namespace data parsed yet. Please upload a Kubernetes log export.
            </div>
          )}
        </div>

        {/* Selected Namespace Metadata Box */}
        <AnimatePresence mode="wait">
          {activeNamespaceData && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 p-4 bg-[#0B0E14] border border-slate-800 rounded-lg"
            >
              <h4 className="text-[10.5px] font-mono text-indigo-400 uppercase tracking-widest mb-2.5">
                Namespace details: {activeNamespaceData.name}
              </h4>
              <div className="grid grid-cols-2 gap-3 text-xs text-slate-400">
                <div>
                  <span className="font-mono text-slate-500 block text-[9px] uppercase tracking-wide">
                    TOTAL PODS
                  </span>
                  <span className="font-semibold text-slate-200 font-mono">
                    {activeNamespaceData.podsCount}
                  </span>
                </div>
                <div>
                  <span className="font-mono text-slate-500 block text-[9px] uppercase tracking-wide">
                    UNIQUE SERVICES
                  </span>
                  <span className="font-semibold text-slate-200 font-mono">
                    {activeNamespaceData.services.length}
                  </span>
                </div>
              </div>
              <div className="mt-3 border-t border-slate-800 pt-2.5">
                <span className="font-mono text-slate-500 block text-[9px] uppercase tracking-wide mb-1.5">
                  MAPPED KUBERNETES SERVICES
                </span>
                <div className="flex flex-wrap gap-1">
                  {activeNamespaceData.services.map((svc) => (
                    <span
                      key={svc}
                      className="text-[9px] bg-slate-800 text-indigo-400 px-1.5 py-0.5 rounded border border-slate-800 font-mono"
                    >
                      {svc}
                    </span>
                  ))}
                  {activeNamespaceData.services.length === 0 && (
                    <span className="text-[10px] text-slate-500 italic">None derived</span>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Pods Investigation List (Column width 8) */}
      <div className="lg:col-span-8 bg-gradient-to-br from-[#0e1324] via-[#090b11] to-[#05070a] border border-[#1b253b]/60 rounded-xl p-5 flex flex-col justify-between shadow-xl">
        <div>
          <div className="flex items-center justify-between mb-4 border-b border-[#1b253b]/60 pb-3">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-emerald-400" />
              <h3 className="font-semibold text-white text-sm tracking-tight flex items-center gap-1.5">
                Pod-Level Investigation
                {selectedNamespace && (
                  <span className="text-xs font-normal text-slate-500">
                    in <span className="font-medium text-slate-400">"{selectedNamespace}"</span>
                  </span>
                )}
              </h3>
            </div>
            <div className="flex items-center gap-1.5">
              <ListFilter className="h-3 w-3 text-slate-500" />
              <span className="text-xs text-slate-400 font-mono">
                Showing {pods.length} pods
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1.5">
            {pods.map((pod) => {
              const isSelected = selectedPod === pod.name;
              const isUnhealthy = pod.healthStatus === "Unhealthy";
              const isWarning = pod.healthStatus === "Warning";

              return (
                <button
                  key={pod.name}
                  onClick={() => setSelectedPod(isSelected ? null : pod.name)}
                  className={`text-left p-3 rounded border transition-all flex items-start justify-between gap-2 ${
                    isSelected
                      ? "bg-[#0B0E14] border-indigo-500/40"
                      : "border-slate-800 hover:bg-[#0B0E14] hover:border-slate-800"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Box className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                      <span className="font-mono text-xs text-slate-200 truncate block">
                        {pod.name}
                      </span>
                    </div>

                    <p className="text-[10px] text-slate-500 truncate mb-1">
                      Namespace: <span className="font-mono text-slate-300">{pod.namespace}</span>
                    </p>

                    <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                      {pod.restartCount > 0 && (
                        <span className="text-amber-400">
                          {pod.restartCount} Restarts
                        </span>
                      )}
                      {pod.errorCount > 0 && <span className="text-red-400">{pod.errorCount} Errors</span>}
                      <span>{pod.containers.size} Containers</span>
                    </div>
                  </div>

                  <span
                    className={`text-[9px] font-bold px-2 py-0.5 rounded shrink-0 font-mono ${
                      isUnhealthy
                        ? "bg-red-950/40 text-red-400 border border-red-900/30"
                        : isWarning
                        ? "bg-amber-950/40 text-amber-400 border border-amber-900/30"
                        : "bg-emerald-950/40 text-emerald-400 border border-emerald-900/30"
                    }`}
                  >
                    {pod.healthStatus}
                  </span>
                </button>
              );
            })}
            {pods.length === 0 && (
              <div className="col-span-2 text-center py-10 text-xs text-slate-500 font-mono">
                No active pods in selected context.
              </div>
            )}
          </div>
        </div>

        {/* Selected Pod Investigation Result Footer */}
        <AnimatePresence mode="wait">
          {activePodData && (
            <motion.div
              id="pod-details-drawer"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mt-6 p-4 border border-slate-800 bg-[#0B0E14] rounded-lg"
            >
              <div className="flex items-start justify-between mb-3 border-b border-slate-800 pb-2">
                <div className="flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-emerald-400" />
                  <span className="font-semibold text-xs text-white truncate max-w-xs sm:max-w-md font-mono">
                    {activePodData.name} Diagnostics
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono">
                  SRE Node Sandbox
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                <div className="bg-[#0D1117] border border-slate-800 p-2 rounded">
                  <span className="text-[9px] text-slate-500 block font-mono">RESTARTS</span>
                  <span className="text-xs font-semibold text-white font-mono">
                    {activePodData.restartCount}
                  </span>
                </div>
                <div className="bg-[#0D1117] border border-slate-800 p-2 rounded">
                  <span className="text-[9px] text-slate-500 block font-mono">ERRORS</span>
                  <span className="text-xs font-semibold text-red-400 font-mono">
                    {activePodData.errorCount}
                  </span>
                </div>
                <div className="bg-[#0D1117] border border-slate-800 p-2 rounded col-span-2">
                  <span className="text-[9px] text-slate-500 block font-mono">CONTAINER IMAGES</span>
                  <span className="text-xs font-semibold text-white truncate block font-mono">
                    {Array.from(activePodData.containers).join(", ") || "No records"}
                  </span>
                </div>
              </div>

              {activePodData.lastFailure && (
                <div className="bg-red-500/10 border border-red-900/30 p-3 rounded">
                  <span className="text-[9px] font-semibold text-red-400 block mb-1 uppercase tracking-wide font-mono">
                    LAST DETECTED POD FAILURE:
                  </span>
                  <p className="text-[11px] font-mono text-red-200 break-words leading-relaxed">
                    {activePodData.lastFailure}
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
