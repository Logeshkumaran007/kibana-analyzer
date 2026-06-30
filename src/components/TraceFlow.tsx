import React, { useState } from "react";
import { LogEntry } from "../types";
import { Search, Compass, AlertOctagon, CheckCircle2, ChevronRight, Activity, ArrowRight, Clock } from "lucide-react";
import { motion } from "motion/react";

interface TraceFlowProps {
  logs: LogEntry[];
}

export default function TraceFlow({ logs }: TraceFlowProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTrace, setSelectedTrace] = useState("");

  // Get all unique trace IDs with errors associated first for faster discovery
  const traceList = Array.from(new Set(logs.map((l) => l.traceId)))
    .filter(Boolean)
    .map((tid) => {
      const traceLogs = logs.filter((l) => l.traceId === tid);
      const hasError = traceLogs.some((l) => l.logLevel === "ERROR" || l.logLevel === "FATAL");
      const serviceCount = new Set(traceLogs.map((l) => l.serviceName)).size;
      return {
        id: tid,
        count: traceLogs.length,
        hasError,
        serviceCount,
      };
    })
    .sort((a, b) => (b.hasError ? 1 : 0) - (a.hasError ? 1 : 0)); // Sort error traces first

  const activeTrace = selectedTrace || (traceList.length > 0 ? traceList[0].id : "");

  // Filter logs for active trace
  const activeLogs = logs
    .filter((l) => l.traceId === activeTrace)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Derive request hops
  // We can construct a standard distributed tracing flowchart:
  // Gateway -> Auth -> Target Service -> Database
  const hasGateway = activeLogs.some((l) => l.serviceName.toLowerCase().includes("gateway"));
  const hasAuth = activeLogs.some((l) => l.serviceName.toLowerCase().includes("auth"));
  // Operational service is any service that is not gateway/auth
  const opLogs = activeLogs.filter((l) => !l.serviceName.toLowerCase().includes("gateway") && !l.serviceName.toLowerCase().includes("auth"));
  const targetService = opLogs.length > 0 ? opLogs[0].serviceName : "Target API Service";
  
  // Heuristics for db log entries
  const hasDBLogs = activeLogs.some((l) => 
    ["postgres", "db", "sql", "hikaripool", "redis", "mysql"].some((kw) => l.errorMessage.toLowerCase().includes(kw))
  );

  // Compute real elapsed time (in ms) from the first log in this trace up to
  // the earliest log matching a given predicate, so latency reflects actual
  // log timestamps rather than placeholder numbers.
  const traceStartMs = activeLogs.length > 0 ? new Date(activeLogs[0].timestamp).getTime() : 0;
  const formatLatency = (matchFn: (l: LogEntry) => boolean): string => {
    if (activeLogs.length === 0) return "—";
    const match = activeLogs.find(matchFn);
    if (!match) return "—";
    const deltaMs = new Date(match.timestamp).getTime() - traceStartMs;
    if (isNaN(deltaMs) || deltaMs < 0) return "—";
    return deltaMs >= 1000 ? `${(deltaMs / 1000).toFixed(2)}s` : `${deltaMs}ms`;
  };

  const gatewayLatency = formatLatency((l) => l.serviceName.toLowerCase().includes("gateway"));
  const authLatency = formatLatency((l) => l.serviceName.toLowerCase().includes("auth"));
  const serviceLatency = opLogs.length > 0 ? formatLatency((l) => l === opLogs[0]) : "—";
  const dbLatency = formatLatency((l) =>
    ["postgres", "db", "sql", "hikaripool", "redis", "mysql", "connection", "pool"].some((kw) =>
      l.errorMessage.toLowerCase().includes(kw)
    )
  );

  const hops = [
    {
      id: "frontend",
      name: "Frontend Client",
      service: "Web-App Client",
      isActive: true,
      status: "SUCCESS" as "SUCCESS" | "FAILURE",
      details: "Client browser initiated POST API requests.",
      latency: "0ms",
    },
    {
      id: "gateway",
      name: "API Gateway",
      service: "ingress-gateway",
      isActive: true, // Gateway is always active in cluster ingress mapping
      status: activeLogs.some((l) => l.serviceName.toLowerCase().includes("gateway") && l.logLevel === "ERROR") ? "FAILURE" : "SUCCESS" as "SUCCESS" | "FAILURE",
      details: hasGateway 
        ? "Ingress routed payload down-channel." 
        : "Gateway proxy routed traffic without logging warnings.",
      latency: hasGateway ? gatewayLatency : "—",
    },
    {
      id: "auth",
      name: "Auth Service",
      service: "auth-api-manager",
      isActive: hasAuth || hasGateway, // default active
      status: activeLogs.some((l) => l.serviceName.toLowerCase().includes("auth") && l.logLevel === "ERROR") ? "FAILURE" : "SUCCESS" as "SUCCESS" | "FAILURE",
      details: hasAuth 
        ? "Validated auth token, confirmed security status." 
        : "Auth bypass or JWT token verified at ingress.",
      latency: hasAuth ? authLatency : "—",
    },
    {
      id: "service",
      name: targetService,
      service: "application-pod",
      isActive: opLogs.length > 0,
      status: opLogs.some((l) => l.logLevel === "ERROR" || l.logLevel === "FATAL") ? "FAILURE" : "SUCCESS" as "SUCCESS" | "FAILURE",
      details: opLogs.length > 0 
        ? opLogs[0].errorMessage.slice(0, 80) + "..." 
        : "Operational backends processed requests without triggers.",
      latency: serviceLatency,
    },
    {
      id: "database",
      name: "Datastore Engine",
      service: "rds-postgres-cluster",
      isActive: hasDBLogs || opLogs.some((l) => l.errorMessage.toLowerCase().includes("connection") || l.errorMessage.toLowerCase().includes("pool")),
      status: activeLogs.some((l) => 
        l.errorMessage.toLowerCase().includes("connection") || 
        l.errorMessage.toLowerCase().includes("hikaripool") || 
        l.errorMessage.toLowerCase().includes("redisbusy")
      ) ? "FAILURE" : "SUCCESS" as "SUCCESS" | "FAILURE",
      details: hasDBLogs 
        ? "Hikari Datasource triggered critical socket state." 
        : "Database queries completed.",
      latency: dbLatency,
    },
  ];

  // If previous hop failed, subsequent hops might have been bypassed or failed!
  let alreadyFailed = false;
  const processedHops = hops.map((hop) => {
    if (!hop.isActive) {
      return { ...hop, status: "BYPASSED" as any };
    }
    if (alreadyFailed) {
      return { ...hop, status: "BYPASSED" as any, details: "Request execution short-circuited due to upstream collapse." };
    }
    if (hop.status === "FAILURE") {
      alreadyFailed = true;
    }
    return hop;
  });

  const filteredTraceList = traceList.filter((t) => t.id.toLowerCase().includes(searchTerm.toLowerCase()));

  // ---- Span Timeline Waterfall: convert each hop's latency string into a
  // millisecond value so we can render a proportional waterfall bar, the way
  // a distributed-tracing console would. Real data only, no mock numbers.
  const parseLatencyMs = (latency: string): number => {
    if (!latency || latency === "—") return 0;
    if (latency.endsWith("ms")) return parseFloat(latency) || 0;
    if (latency.endsWith("s")) return (parseFloat(latency) || 0) * 1000;
    return 0;
  };

  const waterfallSpans = processedHops
    .filter((hop) => hop.status !== "BYPASSED")
    .map((hop) => ({ ...hop, ms: parseLatencyMs(hop.latency) }));
  const maxSpanMs = Math.max(1, ...waterfallSpans.map((s) => s.ms));

  return (
    <div className="bg-gradient-to-br from-[#0e1324] via-[#090b11] to-[#05070a] border border-[#1b253b]/60 rounded-xl p-5 mb-6 shadow-xl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1b253b]/60 pb-4 mb-4">
        <div className="flex items-center gap-2">
          <Compass className="h-5 w-5 text-indigo-400" />
          <div>
            <h3 className="font-semibold text-white text-sm tracking-tight">
              Trace ID Request Flow & Distributed Tracing
            </h3>
            <p className="text-xs text-slate-500">
              Visualize downstream calls, discover bottleneck segments, and trace exception flows.
            </p>
          </div>
        </div>

        {/* Search Input bar */}
        <div className="relative shrink-0 w-full md:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search Traces (e.g. abc123xyz)"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full text-xs pl-8 pr-3 py-2 border border-slate-800 rounded bg-[#0B0E14] focus:outline-none focus:border-indigo-500 text-slate-300"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Trace Finder Sidebar (Col 3) */}
        <div className="lg:col-span-3 border-r border-[#0B0E14] lg:border-slate-800 pr-1 max-h-[350px] overflow-y-auto">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest block mb-2">
            MAPPED TRACE ID KEYS
          </span>
          <div className="space-y-1">
            {filteredTraceList.map((trace) => {
              const isSelected = activeTrace === trace.id;
              return (
                <button
                  key={trace.id}
                  onClick={() => setSelectedTrace(trace.id)}
                  className={`w-full text-left px-2.5 py-2 rounded text-xs transition-colors flex items-center justify-between font-mono ${
                    isSelected
                      ? "bg-indigo-500/10 text-indigo-400 font-bold border border-indigo-500/20"
                      : "hover:bg-[#0B0E14] text-slate-400 border border-transparent"
                  }`}
                >
                  <span className="truncate pr-1">{trace.id}</span>
                  {trace.hasError ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                  )}
                </button>
              );
            })}
            {filteredTraceList.length === 0 && (
              <div className="text-center py-6 text-xs text-slate-500 font-mono">
                No matching Trace IDs.
              </div>
            )}
          </div>
        </div>

        {/* Tracing Timeline Diagram (Col 9) */}
        <div className="lg:col-span-9 flex flex-col justify-between">
          {activeTrace ? (
            <div>
              {/* Visual Hop Flowchart */}
              <div className="mb-6 bg-[#0B0E14] p-5 rounded border border-slate-800">
                <div className="flex flex-col md:flex-row items-center justify-between gap-6 md:gap-3 overflow-x-auto py-2">
                  {processedHops.map((hop, index) => {
                    const isFailed = hop.status === "FAILURE";
                    const isBypassed = hop.status === "BYPASSED";

                    return (
                      <React.Fragment key={hop.id}>
                        {/* Hop Card */}
                        <div className="flex flex-col items-center shrink-0 w-36">
                          <div
                            className={`p-3 rounded border text-center transition-all w-full relative ${
                              isFailed
                                ? "border-red-900/40 bg-red-950/20 text-red-400"
                                : isBypassed
                                ? "border-slate-800 bg-[#0D1117]/40 text-slate-500"
                                : "border-emerald-900/40 bg-emerald-950/15 text-emerald-400"
                            }`}
                          >
                            {/* Failure indicator pill */}
                            {isFailed && (
                              <span className="absolute -top-1.5 right-2 text-[8px] bg-red-600 text-white font-extrabold px-1 py-0.5 rounded uppercase font-mono">
                                OUTAGE
                              </span>
                            )}

                            <span className="text-[10px] uppercase font-bold tracking-wider opacity-60 font-mono">
                              {hop.name}
                            </span>
                            <span className="block text-[11px] font-mono font-medium truncate mt-0.5">
                              {hop.service}
                            </span>
                            <div className="mt-1 flex items-center justify-center gap-1 text-[9px] font-semibold font-mono">
                              <Clock className="h-2.5 w-2.5 text-indigo-400" />
                              <span>{hop.latency}</span>
                            </div>
                          </div>

                          <span className="text-[10px] text-slate-500 italic text-center mt-1.5 line-clamp-2 max-w-[120px] font-mono">
                            {hop.details}
                          </span>
                        </div>

                        {/* Connection Arrow */}
                        {index < processedHops.length - 1 && (
                          <div className="shrink-0 flex items-center md:flex-row flex-col text-slate-600">
                            <ArrowRight className="h-5 w-5 md:block hidden animate-pulse" />
                            <span className="h-5 w-0.5 bg-slate-700 md:hidden block animate-pulse" />
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>

              {/* Span Timeline Waterfall — proportional latency bars per hop */}
              {waterfallSpans.length > 0 && (
                <div className="mb-6 bg-[#0B0E14] p-5 rounded border border-slate-800 space-y-3.5">
                  <span className="text-[10px] font-mono text-violet-400 uppercase tracking-widest font-bold block">
                    SPAN TIMELINE WATERFALL
                  </span>
                  {waterfallSpans.map((span) => {
                    const isError = span.status === "FAILURE";
                    const widthPercent = Math.max(4, (span.ms / maxSpanMs) * 100);
                    return (
                      <div key={span.id} className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <div className="flex items-center gap-2 overflow-hidden mr-2">
                            <span className={`font-semibold truncate font-mono ${isError ? "text-rose-300" : "text-slate-300"}`}>
                              {span.name}
                            </span>
                            <span className="text-[9px] text-slate-500 px-1 bg-slate-950 border border-slate-900 rounded shrink-0 font-mono">
                              {span.service}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500 shrink-0 font-mono">{span.latency}</span>
                        </div>
                        <div className="h-6 w-full bg-slate-950/85 border border-slate-900 rounded-md relative overflow-hidden">
                          <div
                            style={{ width: `${widthPercent}%` }}
                            className={`absolute top-0 left-0 h-full rounded transition-all flex items-center px-2.5 text-[10px] font-mono ${
                              isError
                                ? "bg-gradient-to-r from-red-500/25 to-rose-600/20 border-l-4 border-l-red-500 text-rose-300"
                                : "bg-gradient-to-r from-indigo-500/25 to-violet-600/20 border-l-4 border-l-indigo-400 text-indigo-300"
                            }`}
                          >
                            <span className="font-semibold truncate">{span.latency}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Logs tied specifically to this Trace ID */}
              <div>
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest block mb-2">
                  CHRONOLOGICAL TIMELINE OF THIS CHOSEN TRACE
                </span>
                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1.5 font-mono text-[10px] leading-relaxed">
                  {activeLogs.map((log, idx) => {
                    const isError = log.logLevel === "ERROR" || log.logLevel === "FATAL";
                    return (
                      <div
                        key={idx}
                        className={`p-2.5 rounded border flex items-start gap-2 ${
                          isError
                            ? "bg-red-950/20 border-red-900/30 text-red-300"
                            : "bg-[#0B0E14] border-[#1D2433] text-slate-400"
                        }`}
                      >
                        {isError ? (
                          <AlertOctagon className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <span className="text-slate-500 font-semibold mr-2 shrink-0 select-none">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                          <span className="text-indigo-400 font-bold mr-2 select-none uppercase">
                            [{log.serviceName}]
                          </span>
                          <span>{log.errorMessage}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
              <Compass className="h-12 w-12 text-slate-700 mb-3" />
              <h4 className="font-mono text-slate-400 text-xs uppercase tracking-wide">
                Distributed Trace ID Viewer
              </h4>
              <p className="text-xs text-slate-500 max-w-sm mt-1 font-mono">
                Enter a custom Trace ID or click one from the sidebar list to reconstruct the downstream HTTP cluster call trace graph.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
