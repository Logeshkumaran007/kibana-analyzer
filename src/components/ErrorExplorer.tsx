import React, { useState } from "react";
import { LogEntry } from "../types";
import { AlertCircle, Flame, Server, Network, Layers, ShieldAlert, Cpu, Lock, FileCode } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface ErrorExplorerProps {
  logs: LogEntry[];
  onSelectSample: (
    message: string,
    context: {
      namespace: string;
      podName: string;
      containerName: string;
      serviceName: string;
      incidentCategory?: string;
    },
    autoAnalyze?: boolean
  ) => void;
  selectedLineNumber: number | null;
  onSelectLineNumber: (line: number | null) => void;
}

export interface ErrorCategory {
  id: string;
  name: string;
  keywords: string[];
  icon: any;
  color: string;
  bgColor: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
}

const ERROR_CATEGORIES: ErrorCategory[] = [
  {
    id: "database",
    name: "Database Errors",
    keywords: ["sql", "postgres", "mysql", "hikaripool", "connection is not available", "hikari", "transientconnection", "slow query"],
    icon: Server,
    color: "text-red-500",
    bgColor: "bg-red-50 dark:bg-red-950/20",
    severity: "CRITICAL",
  },
  {
    id: "network",
    name: "Network & DNS Errors",
    keywords: ["socket", "dns", "connection refused", "timeout", "network", "tcp", "resolv", "unreachable"],
    icon: Network,
    color: "text-blue-500",
    bgColor: "bg-blue-50 dark:bg-blue-950/20",
    severity: "HIGH",
  },
  {
    id: "kafka",
    name: "Kafka Broker / Consumer",
    keywords: ["kafka", "consumer", "rebalance", "partition", "commitfailed", "broker", "poll interval"],
    icon: Layers,
    color: "text-purple-500",
    bgColor: "bg-purple-50 dark:bg-purple-950/20",
    severity: "HIGH",
  },
  {
    id: "redis",
    name: "Redis Cache Outages",
    keywords: ["redis", "jedis", "lettuce", "redisbusy", "sentinel"],
    icon: Flame,
    color: "text-rose-500",
    bgColor: "bg-rose-50 dark:bg-rose-950/20",
    severity: "HIGH",
  },
  {
    id: "memory",
    name: "JVM / Memory Issues",
    keywords: ["outofmemory", "metaspace", "heap", "garbage collector", " gc ", "space allocation"],
    icon: Cpu,
    color: "text-pink-500",
    bgColor: "bg-pink-50 dark:bg-pink-950/20",
    severity: "CRITICAL",
  },
  {
    id: "oomkilled",
    name: "Pod OOMKilled",
    keywords: ["oomkilled", "exit code 137"],
    icon: ShieldAlert,
    color: "text-red-600",
    bgColor: "bg-red-100 dark:bg-red-950/40",
    severity: "CRITICAL",
  },
  {
    id: "crashloop",
    name: "CrashLoopBackOff",
    keywords: ["crashloop", "crashloopbackoff", "back-off restarting"],
    icon: ShieldAlert,
    color: "text-orange-500",
    bgColor: "bg-orange-50 dark:bg-orange-950/20",
    severity: "CRITICAL",
  },
  {
    id: "imagepull",
    name: "ImagePullBackOff",
    keywords: ["imagepullbackoff", "errimagepull", "failed pulling image", "registry.scalezee.com"],
    icon: Layers,
    color: "text-amber-500",
    bgColor: "bg-amber-50 dark:bg-amber-950/20",
    severity: "MEDIUM",
  },
  {
    id: "cert",
    name: "Certificate Errors",
    keywords: ["ssl", "certificate", " expired", "handshake", "trustmanager", "pkix"],
    icon: Lock,
    color: "text-teal-500",
    bgColor: "bg-teal-50 dark:bg-teal-950/20",
    severity: "MEDIUM",
  },
  {
    id: "ingress",
    name: "Ingress / Gateway Errors",
    keywords: ["ingress", "nginx.ingress", "502 bad gateway", "too big header", "proxy-buffer", "504 gateway timeout"],
    icon: FileCode,
    color: "text-cyan-500",
    bgColor: "bg-cyan-50 dark:bg-cyan-950/20",
    severity: "HIGH",
  },
];

export default function ErrorExplorer({ logs, onSelectSample, selectedLineNumber, onSelectLineNumber }: ErrorExplorerProps) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Classify errors
  const errors = logs.filter((l) => l.logLevel === "ERROR" || l.logLevel === "FATAL" || l.logLevel === "CRITICAL" || l.exceptionType);

  const matchedErrorSet = new Set<LogEntry>();
  const categoriesWithLogs = ERROR_CATEGORIES.map((cat) => {
    const list = errors.filter((err) => {
      const isMatch = cat.keywords.some((kw) => err.errorMessage.toLowerCase().includes(kw));
      if (isMatch) {
        matchedErrorSet.add(err);
      }
      return isMatch;
    });

    let firstOccurrence = "";
    let lastOccurrence = "";
    if (list.length > 0) {
      const sorted = [...list].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      firstOccurrence = sorted[0].timestamp;
      lastOccurrence = sorted[sorted.length - 1].timestamp;
    }

    return {
      ...cat,
      count: list.length,
      logsList: list,
      firstOccurrence,
      lastOccurrence,
    };
  }).filter((c) => c.count > 0);

  // Catch ALL other errors that do not fall into specific categories
  const uncategorizedLogs = errors.filter((err) => !matchedErrorSet.has(err));
  
  const classifications = [...categoriesWithLogs];
  if (uncategorizedLogs.length > 0) {
    let firstOccur = "";
    let lastOccur = "";
    const sortedUncat = [...uncategorizedLogs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    if (sortedUncat.length > 0) {
      firstOccur = sortedUncat[0].timestamp;
      lastOccur = sortedUncat[sortedUncat.length - 1].timestamp;
    }

    classifications.push({
      id: "uncategorized",
      name: "Other System Failures",
      keywords: [],
      icon: AlertCircle,
      color: "text-amber-400",
      bgColor: "bg-amber-950/20",
      severity: "MEDIUM",
      count: uncategorizedLogs.length,
      logsList: uncategorizedLogs,
      firstOccurrence: firstOccur,
      lastOccurrence: lastOccur,
    });
  }

  const activeCategory = classifications.find((c) => c.id === selectedCategory);

  const handleSelectCategory = (categoryId: string | null) => {
    setSelectedCategory(categoryId);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
      {/* Category List Panel (Left) */}
      <div className="lg:col-span-5 bg-gradient-to-br from-[#0e1324] via-[#090b11] to-[#05070a] border border-[#1b253b]/60 rounded-xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4 border-b border-[#1b253b]/60 pb-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-400" />
            <h3 className="font-semibold text-white text-sm tracking-tight">
              Incident Category Explorer
            </h3>
          </div>
          <span className="text-[10px] bg-red-950/40 text-red-400 border border-red-900/40 px-2 py-0.5 rounded font-mono">
            {errors.length} Failures Grouped
          </span>
        </div>

        <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
          {classifications.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => handleSelectCategory(isSelected ? null : cat.id)}
                className={`w-full text-left p-3.5 rounded border transition-all flex items-center justify-between gap-3 ${
                  isSelected
                    ? "bg-[#0B0E14] border-indigo-500/40"
                    : "border-slate-800 hover:bg-[#0B0E14] hover:border-slate-800"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded border ${cat.bgColor} ${cat.color} shrink-0`}>
                    <cat.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-xs text-white">
                      {cat.name}
                    </h4>
                    <span className="text-[10px] text-slate-500 font-mono">
                      Severity: <span className={cat.severity === "CRITICAL" ? "text-red-400 font-bold" : "text-amber-400"}>{cat.severity}</span>
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xs font-mono bg-red-950/40 text-red-400 border border-red-900/30 px-2.5 py-1 rounded">
                    {cat.count}
                  </span>
                </div>
              </button>
            );
          })}

          {classifications.length === 0 && (
            <div className="text-center py-12 text-xs text-slate-500 leading-normal font-mono">
              No crash signatures matched structural categories.<br />
              All application pods look healthy!
            </div>
          )}
        </div>
      </div>

      {/* Stack Trace / Detail Panel (Right) */}
      <div className="lg:col-span-7 bg-gradient-to-br from-[#0e1324] via-[#090b11] to-[#05070a] border border-[#1b253b]/60 rounded-xl p-5 flex flex-col justify-between min-h-[300px] shadow-xl">
        {activeCategory ? (
          <div className="flex-1 flex flex-col justify-between">
            <div>
              {/* Category Header */}
              <div className="flex justify-between items-start border-b border-[#1b253b]/60 pb-3 mb-4 flex-wrap gap-3">
                <div>
                  <h3 className="font-semibold text-white text-sm tracking-tight">
                    {activeCategory.name} Failures
                  </h3>
                  <div className="flex gap-4 mt-1 text-[10px] text-slate-500 font-mono">
                    <span>
                      First: <span className="text-slate-400 font-mono">{activeCategory.firstOccurrence || "N/A"}</span>
                    </span>
                    <span>
                      Latest: <span className="text-slate-400 font-mono">{activeCategory.lastOccurrence || "N/A"}</span>
                    </span>
                  </div>
                </div>

              </div>

              {/* Exception log details */}
              <div className="space-y-3 max-h-[290px] overflow-y-auto pr-1 font-mono text-[11px] leading-relaxed">
                {activeCategory.logsList.map((err, idx) => {
                  const isSelectedLine = selectedLineNumber === err.lineNumber;
                  return (
                    <div
                      key={idx}
                      onClick={() => {
                        onSelectLineNumber(err.lineNumber);
                        // Scroll to Raw Log Viewer
                        document.getElementById("raw-log-viewer-anchor")?.scrollIntoView({ behavior: "smooth" });
                      }}
                      className={`p-3 bg-[#0B0E14] border rounded cursor-pointer transition-all hover:bg-slate-900/40 hover:border-indigo-500/50 text-left ${
                        isSelectedLine
                          ? "border-indigo-500 bg-indigo-950/15 text-indigo-200"
                          : "border-slate-800 text-slate-300"
                      }`}
                      title="Click to reference in Original Log File Viewer"
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-500 mb-2 border-b border-slate-800 pb-1">
                        <span className="font-semibold text-indigo-400">
                          {err.serviceName} ({err.podName})
                        </span>
                        <div className="flex items-center gap-1">
                          <span className={`${isSelectedLine ? "text-indigo-400 font-extrabold" : "text-indigo-400/80 hover:text-indigo-300"} font-mono text-[10px]`}>
                            Line #{err.lineNumber}
                          </span>
                          <span className="text-[9px] text-slate-600 block sm:inline">• Click to inspect</span>
                        </div>
                      </div>

                      <p className="break-words font-semibold text-slate-200">
                        {err.errorMessage}
                      </p>

                      {err.exceptionType && (
                        <span className="inline-block mt-2 text-[9px] bg-red-950/40 text-red-400 border border-red-900/30 px-1.5 py-0.5 rounded font-mono uppercase">
                          {err.exceptionType}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <AlertCircle className="h-10 w-10 text-slate-600 text-slate-700 mb-2.5" />
            <h4 className="font-mono text-slate-400 text-xs uppercase tracking-wide">
              Failure Log Viewer
            </h4>
            <p className="text-xs text-slate-500 text-slate-500 max-w-sm mt-1 font-mono">
              Select one of the structural error categories on the left to inspect logs, match stack traces, and execute root cause operations.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}