import { LogEntry } from "../types";

// Helper to parse CSV fields manually supporting escaped quotes
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// Extract potential trace IDs from error message
function extractTraceId(message: string): string {
  // Common Trace ID formats (hex 16, 24, 32 chars or traceId=...)
  const match = message.match(/(?:traceId|trace_id|tid|correlation_id|correlationId)["\s:=]+([a-f0-9-]{16,36})/i);
  if (match && match[1]) return match[1];

  const genericHex = message.match(/\b([a-f0-9]{16,32})\b/i);
  if (genericHex && genericHex[1]) return genericHex[1];

  return "";
}

// Extract exception type from stacktraces
function extractException(message: string): string {
  // E.g. java.lang.NullPointerException, RedisConnectionException, Error: ...
  const match = message.match(/\b([a-zA-Z0-9._]+(?:Exception|Error))\b/);
  if (match && match[1]) return match[1];

  if (message.includes("OOM") || message.includes("Out of Memory") || message.includes("OutOfMemory")) {
    return "OutOfMemoryError";
  }
  if (message.includes("Timeout") || message.includes("timeout")) {
    return "TimeoutException";
  }
  if (message.includes("CrashLoopBackOff")) {
    return "CrashLoopBackOff";
  }
  if (message.includes("OOMKilled")) {
    return "OOMKilled";
  }
  if (message.includes("ImagePullBackOff")) {
    return "ImagePullBackOff";
  }

  return "";
}

// Resolve a CSV column index reliably.
// Kibana/ECS exports have many columns that share a substring (e.g. "container.cpu.usage",
// "container.memory.usage", "container.name" all contain "container"). A plain
// `headers.findIndex(h => h.includes("container"))` grabs whichever of those columns
// happens to come first, which is almost never the one we actually want.
// This resolver checks EXACT header names first (in priority order), and only falls
// back to substring search - while explicitly excluding known "metric" columns - if no
// exact match exists.
function resolveColumn(
  headers: string[],
  exactCandidates: string[],
  fallbackIncludes: string[],
  excludeSubstrings: string[] = []
): number {
  for (const candidate of exactCandidates) {
    const idx = headers.indexOf(candidate);
    if (idx !== -1) return idx;
  }
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (excludeSubstrings.some((ex) => h.includes(ex))) continue;
    if (fallbackIncludes.some((f) => h.includes(f))) return i;
  }
  return -1;
}

// Map service names from pod names (e.g., payment-api-6d8b95d4b7-x72rt -> payment-api)
function deriveService(podName: string): string {
  if (!podName) return "Unknown Service";
  // Remove trailing replicas & hash e.g., -6d8b95d4b7-x72rt
  const parts = podName.split("-");
  if (parts.length > 2) {
    // If last part is alphanumeric size 5, and second last is size 9-10
    const last = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];
    if (last.length <= 6 && secondLast.length >= 8) {
      return parts.slice(0, -2).join("-");
    }
  }
  return podName;
}

export function parseLogs(fileContent: string, format: "csv" | "json" | "raw"): LogEntry[] {
  const result: LogEntry[] = [];
  const lines = fileContent.split(/\r?\n/);

  if (format === "json") {
    // Check if it is a JSON array or NDJSON (Newline Delimited JSON)
    const trimmed = fileContent.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((item, idx) => parseJsonObject(item, idx));
        }
      } catch (e) {
        // Fallback to reading lines as individual json if array parsing fails
      }
    }

    // Try Newline Delimited JSON
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const item = JSON.parse(line);
        result.push(parseJsonObject(item, i));
      } catch (e) {
        // Ignore single corrupt line and continue
      }
    }
    return result;
  }

  if (format === "csv") {
    if (lines.length === 0) return [];
    
    // Parse headers
    const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase().replace(/^["']|["']$/g, ""));
    
    // Header mappings.
    // NOTE: ECS/Kibana exports have dozens of dotted columns that share a keyword
    // (kubernetes.pod.cpu.usage, kubernetes.pod.memory.usage, kubernetes.pod.name, ...).
    // resolveColumn() prefers an exact header match, and only falls back to substring
    // search while excluding known metric/label columns - so we don't accidentally bind
    // "pod" to kubernetes.labels.pod-template-hash or "container" to container.cpu.usage.
    const timestampIdx = resolveColumn(
      headers,
      ["@timestamp", "timestamp", "time", "date"],
      ["timestamp"],
      ["beats_state", "kibana_stats", "logstash_stats", "last_terminated"]
    );
    const namespaceIdx = resolveColumn(
      headers,
      ["kubernetes.namespace", "namespace", "ns"],
      ["namespace"],
      ["namespace_labels", "namespace_uid"]
    );
    const podIdx = resolveColumn(
      headers,
      ["kubernetes.pod.name", "pod_name", "podname", "pod.name"],
      ["pod.name", "pod_name", "podname"],
      ["pod-template-hash", "pod.cpu", "pod.memory", "pod.network", "pod.status",
       "pod.start_time", "pod.host_ip", "pod.ip", "pod.uid", "labels.pod"]
    );
    const containerIdx = resolveColumn(
      headers,
      ["kubernetes.container.name", "container.name", "container_name", "containername"],
      ["container.name", "container_name", "containername"],
      ["container.cpu", "container.memory", "container.network", "container.id",
       "container.image", "container.runtime", "container.rootfs", "container.logs",
       "container.status", "container.start_time"]
    );
    const nodeIdx = resolveColumn(
      headers,
      ["kubernetes.node.name", "node_name", "nodename", "node.name"],
      ["node.name", "node_name", "nodename"],
      ["node.pct", "node.labels", "node.uid", "node.hostname"]
    );
    const logLevelIdx = headers.findIndex(h => h.includes("level") || h.includes("loglevel") || h.includes("severity"));
    const messageIdx = resolveColumn(
      headers,
      ["message", "log", "text"],
      ["message", "log", "err", "content", "text"],
      ["logstash_stats"]
    );
    const traceIdIdx = headers.findIndex(h => h.includes("traceid") || h.includes("trace_id") || h.includes("trace.id"));
    const requestIdIdx = headers.findIndex(h => h.includes("requestid") || h.includes("request_id") || h.includes("reqid"));

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = parseCSVLine(line).map(f => f.trim().replace(/^["']|["']$/g, ""));
      if (fields.length <= 1) continue;

      const message = messageIdx !== -1 && fields[messageIdx] ? fields[messageIdx] : line;
      const timestamp = timestampIdx !== -1 && fields[timestampIdx] ? fields[timestampIdx] : new Date().toISOString();
      const podName = podIdx !== -1 && fields[podIdx] ? fields[podIdx] : "";
      // Many real-world Kibana/ECS exports (e.g. a minimal "@timestamp, kubernetes.pod.name,
      // message" export) carry no namespace column at all. Dumping every row into a single
      // literal "default" bucket in that case hides all pod/service grouping in the UI.
      // Fall back to the service derived from the pod name instead, which still gives a
      // meaningful, file-accurate grouping key when the real namespace isn't present.
      const derivedNamespace = podName ? deriveService(podName) : "";
      const namespace =
        namespaceIdx !== -1 && fields[namespaceIdx]
          ? fields[namespaceIdx]
          : derivedNamespace || "unknown-namespace";
      const containerName = containerIdx !== -1 && fields[containerIdx] ? fields[containerIdx] : "";
      const nodeName = nodeIdx !== -1 && fields[nodeIdx] ? fields[nodeIdx] : "";
      const traceId = traceIdIdx !== -1 && fields[traceIdIdx] ? fields[traceIdIdx] : extractTraceId(message);
      const requestId = requestIdIdx !== -1 && fields[requestIdIdx] ? fields[requestIdIdx] : "";
      
      let logLevel = "INFO";
      if (logLevelIdx !== -1 && fields[logLevelIdx]) {
        logLevel = fields[logLevelIdx].toUpperCase();
      } else {
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes("error") || lowerMsg.includes("fatal") || lowerMsg.includes("exception") || lowerMsg.includes("fail")) {
          logLevel = "ERROR";
        } else if (lowerMsg.includes("warn")) {
          logLevel = "WARN";
        }
      }

      result.push({
        timestamp,
        namespace,
        podName,
        containerName,
        nodeName,
        traceId,
        requestId,
        logLevel,
        errorMessage: message,
        exceptionType: extractException(message),
        serviceName: deriveService(podName),
        rawLog: line,
        lineNumber: i + 1
      });
    }

    return result;
  }

  // Raw file parser (Must-gather, raw text logs)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const lowerLine = line.toLowerCase();
    
    // Heuristic date parse
    const dateMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[\d.Z+-]*|[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})/);
    const timestamp = dateMatch ? dateMatch[1] : new Date().toISOString();

    let logLevel = "INFO";
    if (/\b(ERROR|FATAL|SEVERE|CRITICAL)\b/i.test(line)) {
      logLevel = "ERROR";
    } else if (/\b(WARN|WARNING)\b/i.test(line)) {
      logLevel = "WARN";
    } else if (/\b(DEBUG|TRACE)\b/i.test(line)) {
      logLevel = "DEBUG";
    } else if (/\b(INFO)\b/i.test(line)) {
      logLevel = "INFO";
    } else {
      if (lowerLine.includes("error") || lowerLine.includes("fail") || lowerLine.includes("exception") || lowerLine.includes("fatal") || lowerLine.includes("oomkilled") || lowerLine.includes("crashloop")) {
        logLevel = "ERROR";
      } else if (lowerLine.includes("warn")) {
        logLevel = "WARN";
      } else if (lowerLine.includes("debug")) {
        logLevel = "DEBUG";
      }
    }

    // Heuristics for Kubernetes details
    const podMatch = line.match(/\b([a-z0-9-]+-[a-z0-9]{3,12}-[a-z0-9]{3,7})\b/i) || 
                     line.match(/\b([a-z0-9-]+-[a-z0-9]{5,10})\b/i);
    const podName = podMatch ? podMatch[1] : "";

    const nsMatch = line.match(/\bnamespace[s]?[:\/\s]+([a-z0-9-]+)\b/i);
    const namespace = nsMatch ? nsMatch[1] : (podName ? deriveService(podName) : "unknown-namespace");

    const traceId = extractTraceId(line);

    result.push({
      timestamp,
      namespace: namespace || "kube-system",
      podName,
      containerName: podName ? deriveService(podName) : "",
      nodeName: "",
      traceId,
      requestId: "",
      logLevel,
      errorMessage: line,
      exceptionType: extractException(line),
      serviceName: podName ? deriveService(podName) : "System",
      rawLog: line,
      lineNumber: i + 1
    });
  }

  return result;
}

function parseJsonObject(item: any, fallbackIdx: number): LogEntry {
  // Safe deep resolution of keys
  const message = item.message || item.log || item.error || item.errorMessage || item.text || JSON.stringify(item);
  const rawTimestamp = item.timestamp || item["@timestamp"] || item.time || item.date || new Date().toISOString();
  
  const podName = item.podName || item["kubernetes.pod_name"] || item.kubernetes?.pod_name || item.pod_name || item.pod || "";
  const namespace =
    item.namespace || item["kubernetes.namespace"] || item.kubernetes?.namespace ||
    (podName ? deriveService(String(podName)) : "") || "unknown-namespace";
  const containerName = item.containerName || item["kubernetes.container_name"] || item.kubernetes?.container_name || item.container || "";
  const nodeName = item.nodeName || item["kubernetes.node_name"] || item.kubernetes?.node_name || item.node || "";
  
  let logLevel = item.logLevel || item.level || item.log_level || item.severity || "INFO";
  logLevel = String(logLevel).toUpperCase();

  const traceId = item.traceId || item.trace_id || item["trace.id"] || extractTraceId(message);
  const requestId = item.requestId || item.request_id || item["request.id"] || "";

  return {
    timestamp: String(rawTimestamp),
    namespace: String(namespace),
    podName: String(podName),
    containerName: String(containerName),
    nodeName: String(nodeName),
    traceId: String(traceId),
    requestId: String(requestId),
    logLevel,
    errorMessage: String(message),
    exceptionType: extractException(String(message)),
    serviceName: podName ? deriveService(String(podName)) : "System",
    rawLog: JSON.stringify(item),
    lineNumber: fallbackIdx + 1
  };
}
