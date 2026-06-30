import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

// In-memory store for historical incidents (SRE Knowledge Base)
let historicalIncidents = [
  {
    id: "INC-1456",
    title: "HikariCP Database Connection Pool Exhaustion",
    errorPattern: "Connection is not available, request timed out after 30000ms. SocketTimeoutException",
    rootCause: "Database connection pool exhaustion on payment-api module under high concurrent load.",
    resolution: "Increased HikariCP max pool size from 10 to 50, enabled leak detection, and optimized DB slow queries.",
    severity: "CRITICAL"
  },
  {
    id: "INC-2091",
    title: "Redis Failover DNS Resolution Timeout",
    errorPattern: "Redis connection failed. RedisBusyException: Busy writing to stream. DNS resolution failed on port 6379",
    rootCause: "CoreDNS packet drop during Redis cluster failover, causing application pods to hold onto stale connection handles.",
    resolution: "Configured ndots: 2 in Kubernetes deployment dnsConfig and implemented a client-side Redis reconnect backoff strategy.",
    severity: "HIGH"
  },
  {
    id: "INC-3312",
    title: "Kafka Consumer Multi-Thread Rebalance Storm",
    errorPattern: "Consumer group coordinated rebalance failed. CommitFailedException. Max poll interval exceeded",
    rootCause: "Log processing took longer than max.poll.interval.ms, triggering continuous partition rebalances and CPU spikes.",
    resolution: "Decreased max.poll.records to 50, optimized deserialization processing pipeline, and bumped consumer count.",
    severity: "HIGH"
  },
  {
    id: "INC-4105",
    title: "JVM Metaspace OutOfMemoryError (OOMKilled)",
    errorPattern: "java.lang.OutOfMemoryError: Metaspace. Pod terminated with OOMKilled exit code 137",
    rootCause: "Dynamic class generation during runtime JSON mapping leaked memory in the Metaspace segment.",
    resolution: "Standardized compiler optimization flags, replaced Jackson custom serializers, and increased pod memory limits to 2Gi.",
    severity: "CRITICAL"
  },
  {
    id: "INC-0899",
    title: "Ingress Nginx Buffer Overflow header size",
    errorPattern: "upstream sent too big header while reading response header from upstream 502 bad gateway",
    rootCause: "Authorization JWT token header size exceeded the default Nginx ingress buffer parameters.",
    resolution: "Added nginx.ingress.kubernetes.io/proxy-buffer-size: '16k' annotated configs to ingress resource YAML.",
    severity: "MEDIUM"
  }
];

// API: Check server health
app.get("/api/health", (req, res) => {
  const ollamaUrl = process.env.OLLAMA_HOST || "http://192.168.1.202:11434";
  res.json({ status: "ok", ollamaUrl });
});

// API: List models currently available on the configured Ollama instance
app.get("/api/ollama-models", async (req, res) => {
  const ollamaUrl = ((req.query.ollamaUrl as string) || process.env.OLLAMA_HOST || "http://192.168.1.202:11434").trim();
  try {
    const response = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama returned status ${response.status}`);
    }
    const data: any = await response.json();
    const models = Array.isArray(data.models) ? data.models.map((m: any) => m.name) : [];
    res.json({ connected: true, models });
  } catch (error: any) {
    res.json({ connected: false, models: [], error: error.message });
  }
});

// API: Retrieve historical incidents
app.get("/api/history", (req, res) => {
  res.json(historicalIncidents);
});

// API: Save new incident to history
app.post("/api/history", (req, res) => {
  const { title, errorPattern, rootCause, resolution, severity } = req.body;
  if (!title || !rootCause || !resolution) {
    return res.status(400).json({ error: "Missing required fields (title, rootCause, resolution)" });
  }

  const nextId = `INC-${Math.floor(1000 + Math.random() * 9000)}`;
  const newIncident = {
    id: nextId,
    title,
    errorPattern: errorPattern || "",
    rootCause,
    resolution,
    severity: severity || "HIGH"
  };

  historicalIncidents.unshift(newIncident);
  res.json({ success: true, incident: newIncident });
});

// API: AI incident log analyzer & RCA generator (Ollama only)
app.post("/api/analyze", async (req, res) => {
  const { logsSample, contextInfo, ollamaUrl, ollamaModel } = req.body;

  if (!logsSample || logsSample.trim() === "") {
    return res.status(400).json({ error: "No error logs provided for analysis" });
  }

  const serverOllamaUrl = (ollamaUrl || process.env.OLLAMA_HOST || "http://192.168.1.202:11434").trim();
  const model = (ollamaModel || process.env.OLLAMA_MODEL || "gpt-oss:20b").trim();

  const promptText = `
You are an expert Staff SRE and Kubernetes diagnostic engineer. Analyze these Kubernetes logs and context information to construct a precise analysis or Root Cause Analysis (RCA).

--- CONTEXT ---
Namespace: ${contextInfo?.namespace || "Unknown"}
Pod: ${contextInfo?.podName || "Unknown"}
Container: ${contextInfo?.containerName || "Unknown"}
Node: ${contextInfo?.nodeName || "Unknown"}
Service Name: ${contextInfo?.serviceName || "Unknown"}
Incident Category: ${contextInfo?.incidentCategory || "General SRE Investigation"}

--- LOGS SAMPLE ---
${logsSample.slice(0, 5000)}

--- INSTRUCTIONS ---
Analyze the provided log sample. State exactly what is in it and summarize its behaviors.
- IF THE SPECIFIED "INCIDENT CATEGORY" IS "All Discovered Failures" OR GENERAL:
  * Detect, list, and categorize ALL types of incident categories and failures present in this log sample.
  * Provide an overarching diagnostics synthesis covering ALL identified incident categories across the field logs.
- IF ANOTHER SPECIFIC "INCIDENT CATEGORY" IS SPECIFIED ABOVE:
  * Categorize the generated Root Cause Analysis (RCA) report and its diagnostics specifically around and under that category.
  * Your generated title MUST explicitly prefix or reflect this incident category classification (e.g., "[Database Error] Connecting HikariPool Failed" or "[Network Outage] DNS Resolution Failure").
- IF THERE ARE NO ERRORS, EXCEPTIONS, WARNINGS, OR RETRY/FAILURE ENTRIES IN THE LOGS:
  * You MUST explicitly set "primaryError" to exactly: "No active error is present in the logs."
  * Set "title" to "Healthy System Log Summary".
  * Summarize what activities reside inside the log file in the "rootCause" and "impactAnalysis" fields.
  * In "recommendedFix", state: "No corrective actions or troubleshooting necessary, as logs indicate a healthy, stable operating system."
- IF THERE ARE ANY ERRORS, EXCEPTIONS, WARNINGS, FAILS, REPEATING DISCONNECTIONS, BAD EXPORT ATTEMPTS, OR ANOMALIES AT ALL IN THE LOGS:
  * Identify what the issue is. You MUST provide the direct error/warning message in "primaryError".
  * Set "title" to a descriptive title representing the parsed error/warning.
  * In "rootCause", explain what is causing these logs to print errors or warnings.
  * In "impactAnalysis", explain the effect this issue has on the service and the cluster.
  * In "recommendedFix", offer a detailed, actionable step-by-step resolution command/guide.

You MUST respond with a valid JSON representation containing EXACTLY these schema properties:
{
  "title": "A concise title of the log analysis/incident",
  "primaryError": "Direct exception/error statement caught OR status text stating no active error",
  "rootCause": "Deep architectural/operational root cause explanation",
  "affectedService": "The core service affected",
  "impactAnalysis": "System impact description",
  "recommendedFix": "Step-by-step resolution steps for developers",
  "confidence": 100,
  "preventiveActions": [
    "Preventative action 1",
    "Preventative action 2",
    "Preventative action 3"
  ],
  "timeline": [
    {
      "timestamp": "T-0",
      "service": "api-gateway",
      "event": "Event occurring in log timeline segment",
      "status": "SUCCESS"
    }
  ]
}

Respond ONLY with this JSON. No extra commentary, no conversation, no markdown wrapper outside of pure valid JSON.
`;

  try {
    const ollamaResponse = await fetch(`${serverOllamaUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model,
        prompt: promptText,
        stream: false
      })
    });

    if (!ollamaResponse.ok) {
      const errorText = await ollamaResponse.text();
      throw new Error(`Ollama request failed with status ${ollamaResponse.status}: ${errorText}`);
    }

    const ollamaResult = await ollamaResponse.json();
    let responseText = ollamaResult.response || "";
    responseText = responseText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

    if (!responseText) {
        throw new Error(
            `Ollama returned an empty response.\n${JSON.stringify(ollamaResult, null, 2)}`
       );
     }

    let result;

    try {
       result = JSON.parse(responseText);
    } catch (err) {
    console.error("Invalid JSON returned by Ollama:");
    console.error(responseText);

    throw new Error("Model did not return valid JSON.");
}
    return res.json(result);
  } catch (error: any) {
    console.error("Ollama SRE analysis failed:", error);
    return res.status(500).json({
      error: `Ollama analysis failed: ${error.message}`,
      setupInstructions: `Make sure Ollama is running at ${serverOllamaUrl} with model "${model}" pulled. Run: ollama pull ${model} && ollama serve`
    });
  }
});

// API: Match incident against knowledge base
app.post("/api/match-historical", async (req, res) => {
  const { currentRCA, ollamaUrl, ollamaModel } = req.body;

  if (!currentRCA) {
    return res.status(400).json({ error: "Missing current RCA payload to match" });
  }

  const getRuleBasedMatch = () => {
    const currentText = `${currentRCA.primaryError} ${currentRCA.rootCause}`.toLowerCase();
    let bestMatch = historicalIncidents[0];
    let score = 25;

    for (const incident of historicalIncidents) {
      let tempScore = 0;
      if (currentText.includes("connection") || currentText.includes("pool") || currentText.includes("hikaricp")) {
        if (incident.id === "INC-1456") tempScore = 95;
      }
      if (currentText.includes("redis") || currentText.includes("cache")) {
        if (incident.id === "INC-2091") tempScore = 91;
      }
      if (currentText.includes("kafka") || currentText.includes("consumer") || currentText.includes("partition")) {
        if (incident.id === "INC-3312") tempScore = 88;
      }
      if (currentText.includes("outofmemory") || currentText.includes("oom") || currentText.includes("metaspace")) {
        if (incident.id === "INC-4105") tempScore = 93;
      }
      if (currentText.includes("ingress") || currentText.includes("nginx") || currentText.includes("header")) {
        if (incident.id === "INC-0899") tempScore = 87;
      }

      if (tempScore > score) {
        score = tempScore;
        bestMatch = incident;
      }
    }

    return {
      matched: score > 30 ? bestMatch : null,
      score: score,
      explanation: score > 30
        ? `Matched because pattern references '${bestMatch.id}' in the root cause context analysis.`
        : "No highly matching past incidents found in Kubernetes system memory."
    };
  };

  const serverOllamaUrl = (ollamaUrl || process.env.OLLAMA_HOST || "http://192.168.1.202:11434").trim();
  const model = (ollamaModel || process.env.OLLAMA_MODEL || "gpt-oss:20b").trim();

  try {
    const promptCompare = `
Compare this newly analyzed incident with our Knowledge Base of historical SRE incidents. Identify potential matches and respond strictly in JSON.

--- NEW INCIDENT ---
Title: ${currentRCA.title}
Primary Error: ${currentRCA.primaryError}
Root Cause: ${currentRCA.rootCause}

--- HISTORICAL MICROSERVICES KNOWLEDGE BASE ---
${JSON.stringify(historicalIncidents, null, 2)}

You MUST respond with a JSON object containing:
{
  "matchedId": "The ID of the matching historical incident (e.g. INC-1456), or null if similarity is below 45%",
  "score": 85,
  "explanation": "Provide a 1-sentence rationale regarding similarities"
}

Respond ONLY with valid JSON.
`;

    const ollamaResponse = await fetch(`${serverOllamaUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model,
        prompt: promptCompare,
        stream: false
      })
    });

    if (ollamaResponse.ok) {
      const ollamaResult = await ollamaResponse.json();
      let responseText = ollamaResult.response || "";
      responseText = responseText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      const parsed = JSON.parse(responseText);
      const matched = historicalIncidents.find(inc => inc.id === parsed.matchedId) || null;
      return res.json({
        matched,
        score: parsed.score || 0,
        explanation: parsed.explanation || ""
      });
    }
  } catch (ollamaErr) {
    console.warn("Ollama comparison failed, fallback to rule-based match:", ollamaErr);
  }

  return res.json(getRuleBasedMatch());
});

// Vite & Static file handling
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
