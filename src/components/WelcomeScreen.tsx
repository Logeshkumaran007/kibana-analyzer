import React from "react";
import { Terminal, UploadCloud, LayoutGrid, GitBranch, FileSearch2, ArrowRight, Sparkles } from "lucide-react";
import { motion } from "motion/react";

interface WelcomeScreenProps {
  onStart: () => void;
}

const FLOW_STEPS = [
  { icon: UploadCloud, label: "Import" },
  { icon: LayoutGrid, label: "Explore" },
  { icon: FileSearch2, label: "Console" },
  { icon: GitBranch, label: "Trace / RCA" },
];

export default function WelcomeScreen({ onStart }: WelcomeScreenProps) {
  return (
    <div className="min-h-screen bg-[#04060d] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.18),rgba(255,255,255,0))] text-slate-300 font-sans flex flex-col items-center justify-center px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-2xl text-center"
      >
        {/* Brand mark */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-12 h-12 bg-gradient-to-tr from-indigo-600 to-violet-600 rounded-xl flex items-center justify-center text-white shadow-[0_0_24px_rgba(99,102,241,0.35)]">
            <Terminal className="h-6 w-6" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white bg-gradient-to-r from-white via-[#e2e8f0] to-[#94a3b8] bg-clip-text text-transparent">
            KIBANA <span className="text-indigo-400">ANALYZER</span>
          </h1>
        </div>

        <p className="text-sm text-slate-400 leading-relaxed max-w-lg mx-auto mb-10">
          Drop in your logs, walk the guided wizard, and let AI trace the request flow down to root cause —
          all in one connected workspace.
        </p>

        {/* Mini step preview */}
        <div className="flex items-center justify-center gap-2 sm:gap-3 mb-12 flex-wrap">
          {FLOW_STEPS.map((step, idx) => (
            <React.Fragment key={step.label}>
              <div className="flex items-center gap-2 bg-[#0B0E14] border border-slate-800 rounded-lg px-3 py-2">
                <step.icon className="h-3.5 w-3.5 text-indigo-400" />
                <span className="text-[11px] font-mono font-semibold text-slate-300">{step.label}</span>
              </div>
              {idx < FLOW_STEPS.length - 1 && (
                <ArrowRight className="h-3.5 w-3.5 text-slate-700 shrink-0" />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Start button */}
        <button
          type="button"
          onClick={onStart}
          className="group inline-flex items-center gap-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-sm px-8 py-3.5 rounded-xl transition-all shadow-[0_0_20px_rgba(99,102,241,0.25)]"
        >
          <Sparkles className="h-4 w-4" />
          Start
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </button>

        <p className="text-[10.5px] text-slate-600 font-mono mt-6 uppercase tracking-widest">
          Offline SRE Sandbox · No setup required
        </p>
      </motion.div>
    </div>
  );
}
