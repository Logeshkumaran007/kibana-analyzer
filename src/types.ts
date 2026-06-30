export interface LogEntry {
  timestamp: string;
  namespace: string;
  podName: string;
  containerName: string;
  nodeName: string;
  traceId: string;
  requestId: string;
  logLevel: string; // 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' etc.
  exceptionType?: string;
  errorMessage: string;
  serviceName: string;
  rawLog: string;
  lineNumber: number;
}

export interface IncidentRCA {
  id: string;
  title: string;
  timestamp: string;
  primaryError: string;
  rootCause: string;
  affectedService: string;
  impactAnalysis: string;
  recommendedFix: string;
  confidence: number;
  preventiveActions: string[];
  affectedNamespace: string;
  affectedPod: string;
  timeline?: { timestamp: string; service: string; event: string; status: 'SUCCESS' | 'FAILURE' }[];
}

export interface HistoricalIncident {
  id: string;
  title: string;
  errorPattern: string;
  rootCause: string;
  resolution: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface DashboardStats {
  namespacesCount: number;
  podsCount: number;
  errorsCount: number;
  warningsCount: number;
  traceIdsCount: number;
  logsCount: number;
}
