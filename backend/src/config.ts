import dotenv from "dotenv";
import * as Sentry from "@sentry/node";
import path from "node:path";
import { Agent, setGlobalDispatcher } from "undici";

// Allow local Ollama inference on CPU without hitting Undici headers timeout
setGlobalDispatcher(
  new Agent({
    headersTimeout: 0,
    bodyTimeout: 0,
    connectTimeout: 60000,
  })
);

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3456", 10),
  sentryDsn: process.env.SENTRY_DSN || "",
  mongodbUri: process.env.MONGODB_URI || "",
  dbName: process.env.MONGODB_DB_NAME || "standup_sloth",
  ollamaHost: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "gemma2:9b",
};

// Initialize Sentry Agent Tracing if DSN is provided
if (config.sentryDsn) {
  Sentry.init({
    dsn: config.sentryDsn,
    tracesSampleRate: 1.0,
    environment: process.env.NODE_ENV || "development",
  });
  console.log("🛡️  Sentry Agent Tracing initialized.");
} else {
  console.log("ℹ️  Sentry DSN not set. Tracing will run in mock/log mode.");
}

export { Sentry };
