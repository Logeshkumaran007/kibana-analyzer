import React, { useState, useEffect, useRef } from "react";
import { LogEntry } from "../types";
import { Terminal, Search, Hash, ChevronLeft, ChevronRight, Filter, AlertTriangle, Info } from "lucide-react";
import { motion } from "motion/react";

interface RawLogViewerProps {
  logs: LogEntry[];
  selectedLineNumber: number | null;
  onSelectLineNumber: (line: number | null) => void;
}

const LINES_PER_PAGE = 200;

export default function RawLogViewer({ logs, selectedLineNumber, onSelectLineNumber }: RawLogViewerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [logLevelFilter, setLogLevelFilter] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [jumpInput, setJumpInput] = useState("");
  
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  // Compile the search term as a case-insensitive regex when possible.
  // Falls back to plain substring matching if the pattern is invalid,
  // so a stray regex special character never breaks the search entirely.
  let searchRegex: RegExp | null = null;
  let isInvalidRegex = false;
  if (searchTerm !== "") {
    try {
      searchRegex = new RegExp(searchTerm, "i");
    } catch (e) {
      isInvalidRegex = true;
    }
  }

  // Calculate pages and slice data
  // Filter logs first based on search & levels
  const filteredLogs = logs.filter((log) => {
    let matchesSearch = true;
    if (searchTerm !== "") {
      if (searchRegex) {
        matchesSearch = searchRegex.test(log.rawLog) || searchRegex.test(log.errorMessage);
      } else {
        // Invalid regex pattern: fall back to a plain substring match
        matchesSearch =
          log.rawLog.toLowerCase().includes(searchTerm.toLowerCase()) ||
          log.errorMessage.toLowerCase().includes(searchTerm.toLowerCase());
      }
    }

    const matchesLevel = logLevelFilter === "ALL" || log.logLevel.toUpperCase() === logLevelFilter.toUpperCase();
    
    return matchesSearch && matchesLevel;
  });

  const totalPages = Math.ceil(filteredLogs.length / LINES_PER_PAGE) || 1;

  // Whenever a selectedLineNumber is updated externally, jump to the correct page of that line
  useEffect(() => {
    if (selectedLineNumber !== null) {
      // Find the index of the log entry with this line number in our filtered list
      const indexInFiltered = filteredLogs.findIndex(l => l.lineNumber === selectedLineNumber);
      
      if (indexInFiltered !== -1) {
        const calculatedPage = Math.floor(indexInFiltered / LINES_PER_PAGE) + 1;
        setCurrentPage(calculatedPage);
        
        // Scroll to the line indicator
        setTimeout(() => {
          const el = lineRefs.current[selectedLineNumber];
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 300);
      }
    }
  }, [selectedLineNumber, logs, searchTerm, logLevelFilter]);

  // Handle page changes
  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
  };

  // Jump to specific line input
  const handleJumpToLine = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedLine = parseInt(jumpInput, 10);
    if (isNaN(parsedLine)) return;

    // Check if line exists
    const lineExists = logs.some(l => l.lineNumber === parsedLine);
    if (lineExists) {
      onSelectLineNumber(parsedLine);
      setJumpInput("");
    } else {
      alert(`Line #${parsedLine} not found in parsed log entries`);
    }
  };

  const pageStartIndex = (currentPage - 1) * LINES_PER_PAGE;
  const paginatedLogs = filteredLogs.slice(pageStartIndex, pageStartIndex + LINES_PER_PAGE);

  // Get unique log levels for filtering
  const logLevels = Array.from(new Set(logs.map(l => l.logLevel.toUpperCase()))).filter(Boolean);

  return (
    <div id="raw-log-viewer-anchor" className="bg-gradient-to-br from-[#0e1324] via-[#090b11] to-[#05070a] border border-[#1b253b]/60 rounded-xl p-5 mb-6 shadow-xl">
      
      {/* Header section with status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1b253b]/60 pb-4 mb-4">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-indigo-400" />
          <div>
            <h3 className="font-semibold text-white text-sm tracking-tight flex items-center gap-2">
              Original Log File Console
              <span className="text-[10px] bg-indigo-500/10 text-indigo-300 font-mono px-2 py-0.5 rounded border border-indigo-500/20">
                LINE-BY-LINE BROWSER
              </span>
            </h3>
            <p className="text-xs text-slate-500 text-slate-500 font-mono">
              Inspect raw lines from the uploaded export file. Selected errors map directly to their index.
            </p>
          </div>
        </div>

        {/* Jump-to-line control */}
        <form onSubmit={handleJumpToLine} className="flex items-center gap-1.5 shrink-0 self-end md:self-auto">
          <span className="text-[10px] text-slate-500 font-mono">Jump to Line:</span>
          <div className="relative">
            <Hash className="absolute left-2 top-2.5 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="e.g. 154"
              value={jumpInput}
              onChange={(e) => setJumpInput(e.target.value)}
              className="w-24 text-xs font-mono pl-6 pr-2 py-1.5 border border-slate-800 rounded bg-[#0B0E14] focus:outline-none focus:border-indigo-500 text-slate-300"
            />
          </div>
          <button
            type="submit"
            className="text-[11px] font-semibold bg-indigo-600/90 hover:bg-indigo-600 text-white px-2.5 py-1.5 rounded transition-colors font-mono"
          >
            GO
          </button>
        </form>
      </div>

      {/* Filter and search control bar */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-6 text-xs">
        {/* Search input */}
        <div className="md:col-span-6 relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            placeholder="Regex search raw log entries..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            className={`w-full pl-8 pr-3 py-2 border rounded bg-[#0B0E14] focus:outline-none text-slate-300 font-mono text-[11px] ${
              isInvalidRegex ? "border-amber-500/50 focus:border-amber-500" : "border-slate-800 focus:border-indigo-500"
            }`}
          />
          {isInvalidRegex && (
            <p className="absolute -bottom-5 left-0 text-[10px] text-amber-400 font-mono">
              Invalid regex — falling back to plain text match
            </p>
          )}
        </div>

        {/* Log level filter */}
        <div className="md:col-span-3 flex items-center gap-2">
          <span className="text-slate-500 shrink-0 font-mono text-[11px]">Level:</span>
          <select
            value={logLevelFilter}
            onChange={(e) => {
              setLogLevelFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full py-2 px-2.5 border border-slate-800 rounded bg-[#0B0E14] focus:outline-none focus:border-indigo-500 text-slate-300 font-mono text-[11px] cursor-pointer"
          >
            <option value="ALL">ALL LEVELS</option>
            {logLevels.map(lvl => (
              <option key={lvl} value={lvl}>{lvl}</option>
            ))}
          </select>
        </div>

        {/* Clear active selection */}
        {selectedLineNumber !== null && (
          <div className="md:col-span-3 flex justify-end items-center">
            <button
              onClick={() => onSelectLineNumber(null)}
              className="w-full py-2 px-3 text-center border border-indigo-500/20 bg-indigo-500/5 hover:bg-indigo-500/10 text-indigo-400 font-semibold rounded text-[11px] font-mono transition-all"
            >
              Clear Line selection (Line #{selectedLineNumber})
            </button>
          </div>
        )}
      </div>

      {/* Terminal View area */}
      <div 
        ref={containerRef}
        className="border border-slate-800 bg-[#07090E] rounded-md overflow-x-auto font-mono text-[11px] leading-relaxed select-text shadow-inner max-h-[450px] overflow-y-auto"
      >
        <div className="min-w-[800px] py-2">
          {paginatedLogs.map((log) => {
            const isSelected = selectedLineNumber === log.lineNumber;
            const isError = log.logLevel === "ERROR" || log.logLevel === "FATAL" || log.logLevel === "CRITICAL";
            const isWarn = log.logLevel === "WARN" || log.logLevel === "WARNING";

            return (
              <div
                key={log.lineNumber}
                ref={(el) => {
                  lineRefs.current[log.lineNumber] = el;
                }}
                className={`flex items-start px-4 py-0.5 border-l-2 transition-all hover:bg-slate-900 hover:bg-indigo-950/10 ${
                  isSelected
                    ? "bg-indigo-950/20 border-indigo-500 text-indigo-200 font-medium scale-[1.002] ring-1 ring-indigo-500/10"
                    : isError
                    ? "border-red-900/30 text-rose-300 bg-red-950/5"
                    : isWarn
                    ? "border-amber-900/30 text-amber-200"
                    : "border-transparent text-slate-400"
                }`}
              >
                {/* Line number column (constant width) */}
                <div 
                  onClick={() => onSelectLineNumber(log.lineNumber)}
                  className={`w-12 shrink-0 select-none text-right pr-3 font-mono cursor-pointer hover:text-indigo-400 transition-colors ${
                    isSelected ? "text-indigo-400 font-bold" : "text-slate-600"
                  }`}
                  title="Click to reference or highlight line"
                >
                  {log.lineNumber}
                </div>

                {/* Level / Namespace tag column */}
                <div className="w-40 shrink-0 select-none flex items-center gap-1.5 font-mono text-[10px]">
                  {log.logLevel && (
                    <span className={`px-1 rounded-sm uppercase tracking-wider text-[8px] font-bold ${
                      isError 
                        ? "bg-red-500/10 text-red-400 border border-red-500/20" 
                        : isWarn 
                        ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" 
                        : "bg-slate-800 bg-slate-800/50 text-slate-500"
                    }`}>
                      {log.logLevel}
                    </span>
                  )}
                  {log.serviceName && (
                    <span className="text-slate-500 font-normal truncate" title={log.serviceName}>
                      [{log.serviceName}]
                    </span>
                  )}
                </div>

                {/* Raw log message string */}
                <div className="flex-1 break-all whitespace-pre-wrap font-mono text-[11px]">
                  {log.rawLog}
                </div>
              </div>
            );
          })}

          {filteredLogs.length === 0 && (
            <div className="py-20 text-center text-slate-500 text-slate-500 flex flex-col items-center justify-center font-mono text-xs">
              <AlertTriangle className="h-8 w-8 text-slate-700 text-slate-700 text-slate-600 mb-2" />
              <span>No lines in raw file match the active filter criteria.</span>
            </div>
          )}
        </div>
      </div>

      {/* Pagination control footer bar */}
      <div className="flex items-center justify-between mt-4 text-xs font-mono border-t border-slate-800 pt-4 flex-wrap gap-3">
        <div className="text-slate-500">
          Showing <span className="text-slate-300 font-semibold">{paginatedLogs.length}</span> lines ({pageStartIndex + 1}-{Math.min(pageStartIndex + LINES_PER_PAGE, filteredLogs.length)} of <span className="text-slate-300 font-semibold">{filteredLogs.length}</span> total filtered rows)
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="p-1 px-2 border border-slate-800 bg-[#0B0E14] text-slate-400 rounded disabled:opacity-30 disabled:pointer-events-none hover:bg-slate-800 transition-colors flex items-center gap-1"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev
          </button>

          <span className="text-slate-400 px-1 text-[11px]">
            Page <span className="text-white font-semibold">{currentPage}</span> of <span className="text-white font-semibold">{totalPages}</span>
          </span>

          <button
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="p-1 px-2 border border-slate-800 bg-[#0B0E14] text-slate-400 rounded disabled:opacity-30 disabled:pointer-events-none hover:bg-slate-800 transition-colors flex items-center gap-1"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
