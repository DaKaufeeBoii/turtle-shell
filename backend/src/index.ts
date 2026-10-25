import express from "express";
import cors from "cors";
import path from "node:path";
import { config, Sentry } from "./config.js";
import { connectMongo, getRecentStandups, searchStandups } from "./memory/mongoMemory.js";
import { runStandupSloth } from "./agent/slothAgent.js";
import ollama from "ollama";

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files from ../frontend
const frontendDist = path.resolve("../frontend");
app.use(express.static(frontendDist));

/**
 * Health & Configuration Status
 */
app.get("/api/status", async (_req, res) => {
  let ollamaStatus = "offline";
  let gemmaAvailable = false;

  try {
    const list = await ollama.list();
    ollamaStatus = "online";
    gemmaAvailable = list.models.some((m) => m.name.includes("gemma2:9b"));
  } catch {
    // Ollama not reachable
  }

  res.json({
    app: "StandupSloth",
    version: "1.0.0",
    theme: "Slow and Steady (Hacktoberfest 2026)",
    sentry: {
      enabled: !!config.sentryDsn,
      environment: process.env.NODE_ENV || "development",
    },
    mongodb: {
      configured: !!config.mongodbUri,
    },
    ollama: {
      status: ollamaStatus,
      model: config.ollamaModel,
      available: gemmaAvailable,
    },
  });
});

/**
 * Main Standup Generation Endpoint
 */
app.post("/api/generate", async (req, res) => {
  const { repoPath, since } = req.body;
  const targetPath = repoPath || path.resolve("../.."); // Default to Hacktoberfest repo or cwd
  const targetSince = since || "24 hours ago";

  try {
    const result = await runStandupSloth(targetPath, targetSince, (step, detail) => {
      console.log(`[Sloth Step] ${step}: ${detail || ""}`);
    });

    res.json(result);
  } catch (error: any) {
    console.error("Error running StandupSloth:", error);
    Sentry.captureException(error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to generate standup",
    });
  }
});

/**
 * Recent Standup History
 */
app.get("/api/history", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const history = await getRecentStandups(limit);
    res.json({ success: true, history });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Search Past Standups (Vector/Semantic query)
 */
app.get("/api/search", async (req, res) => {
  const query = (req.query.q as string) || "";
  if (!query) {
    return res.status(400).json({ success: false, error: "Query parameter 'q' is required" });
  }

  try {
    const results = await searchStandups(query);
    res.json({ success: true, query, results });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback to index.html for SPA routing
app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

// Start Server
async function startServer() {
  await connectMongo();

  app.listen(config.port, () => {
    console.log(`🦥 StandupSloth Server running at http://localhost:${config.port}`);
    console.log(`💻 Local Gemma 2 9B model: ${config.ollamaModel}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
