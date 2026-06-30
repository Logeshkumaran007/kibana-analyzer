import React from "react";
import { DashboardStats } from "../types";
import { AlertCircle, AlertTriangle, ShieldAlert, FileText } from "lucide-react";
import { motion } from "motion/react";

interface MetricCardsProps {
  stats: DashboardStats;
}

export default function MetricCards({ stats }: MetricCardsProps) {
  const cardData = [
    {
      id: "stats-errors",
      name: "Logged Errors",
      value: stats.errorsCount,
      icon: ShieldAlert,
      color: "text-red-400 bg-red-500/10 border-red-500/20",
    },
    {
      id: "stats-warnings",
      name: "Logged Warnings",
      value: stats.warningsCount,
      icon: AlertTriangle,
      color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    },
    {
      id: "stats-traceids",
      name: "Parsed Trace IDs",
      value: stats.traceIdsCount,
      icon: AlertCircle,
      color: "text-teal-400 bg-teal-500/10 border-teal-500/20",
    },
    {
      id: "stats-logs",
      name: "Total Logs Scanned",
      value: stats.logsCount,
      icon: FileText,
      color: "text-slate-400 bg-slate-500/10 border-slate-500/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {cardData.map((card, idx) => (
        <motion.div
          key={card.name}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: idx * 0.05 }}
          whileHover={{ y: -3, scale: 1.02 }}
          className="bg-gradient-to-br from-[#0e1324] via-[#090b11] to-[#05070a] border border-[#1b253b]/60 rounded-xl p-4 flex items-center transition-all shadow-[0_4px_20px_-4px_rgba(0,0,0,0.3)] hover:shadow-[0_0_20px_2px_rgba(99,102,241,0.08)] group hover:border-indigo-500/40 cursor-default"
        >
          <div className={`p-2.5 rounded-lg border mr-3 ${card.color} shrink-0 transition-transform group-hover:scale-110 shadow-sm`}>
            <card.icon className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 truncate">
              {card.name}
            </p>
            <p className="text-xl font-bold tracking-tight text-white font-mono mt-0.5">
              {card.value.toLocaleString()}
            </p>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
