import React, { useRef, useState } from "react";
import { UploadCloud, FileText, Database, Flame, Server, Sparkles } from "lucide-react";

interface LogUploadAreaProps {
  onLogsLoaded: (logText: string, format: "csv" | "json" | "raw") => void;
}

export default function LogUploadArea({ onLogsLoaded }: LogUploadAreaProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [pastedLogs, setPastedLogs] = useState("");

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lowerName = file.name.toLowerCase();

      let format: "csv" | "json" | "raw" = "raw";
      if (lowerName.endsWith(".csv")) format = "csv";
      else if (lowerName.endsWith(".json") || lowerName.endsWith(".ndjson")) format = "json";

      onLogsLoaded(text, format);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const pasteSubmit = () => {
    if (!pastedLogs.trim()) return;
    let format: "csv" | "json" | "raw" = "raw";
    const trimmed = pastedLogs.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      format = "json";
    } else if (trimmed.includes(",") && trimmed.split("\n")[0].toLowerCase().includes("message")) {
      format = "csv";
    }
    onLogsLoaded(trimmed, format);
    setPastedLogs("");
  };

  return (
    <div className="bg-gradient-to-br from-[#0e1324] via-[#090b11] to-[#05070a] border border-[#1b253b]/60 rounded-xl p-5 mb-6 shadow-xl">
      <h3 className="font-semibold text-white text-sm tracking-tight mb-4 flex items-center gap-2">
        <UploadCloud className="h-4 w-4 text-indigo-400" />
        Log & Incident Import Console
      </h3>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Drag and Drop Box */}
        <div>
          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center min-h-[160px] ${
              dragActive
                ? "border-indigo-400 bg-indigo-500/10 shadow-[0_0_15px_rgba(99,102,241,0.2)]"
                : "border-[#1b253b]/80 bg-[#06080e]/60 hover:border-slate-600 hover:bg-slate-900/10"
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInput}
              className="hidden"
              accept=".csv,.json,.ndjson,.log,.txt"
            />
            <UploadCloud className="h-8 w-8 text-indigo-400 mb-2.5 transition-transform duration-200 hover:scale-110" />
            <p className="font-bold text-xs text-slate-200 uppercase tracking-wide font-mono">
              Drag & Drop Kubernetes Log Files Here
            </p>
            <p className="text-[10px] text-slate-500 mt-1 max-w-sm font-mono text-center leading-normal">
              Supports Kibana CSV Exports, Elasticsearch JSON stacks, OpenShift Must-Gather structures, or raw console .log prints.
            </p>
          </div>
        </div>

        {/* Text Area direct paste */}
        <div className="flex flex-col justify-between">
          <div className="flex-1 flex flex-col justify-between h-full gap-3">
            <textarea
              placeholder="Or paste application error logs or stack traces directly here..."
              value={pastedLogs}
              onChange={(e) => setPastedLogs(e.target.value)}
              className="w-full text-xs p-3 border border-[#1b253b]/80 bg-[#06080e]/60 rounded-lg focus:outline-none focus:border-indigo-500 min-h-[110px] text-slate-300 font-mono resize-none focus:ring-1 focus:ring-indigo-500/30 font-mono text-[11px]"
            />
            {pastedLogs && (
              <button
                onClick={pasteSubmit}
                className="w-full text-xs text-center bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold py-2 rounded transition-all shadow-md font-mono uppercase tracking-wide cursor-pointer"
              >
                Analyze Pasted Incident Log
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
