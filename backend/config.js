import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, "..");
export const ROSTER_PATH = path.join(ROOT, "model", "config", "instances.json");
export const LOGS_DIR = path.join(ROOT, "model", "data", "logs");
export const ARTIFACTS = path.join(ROOT, "model", "artifacts");

export const config = {
  port: parseInt(process.env.PORT || "4000", 10),
  predictUrl: process.env.PREDICT_URL || "http://localhost:8000",
  mongoUri: process.env.MONGODB_URI || "mongodb://localhost:27017",
  mongoDb: process.env.MONGODB_DB || "labsentinel",
  tickSeconds: parseInt(process.env.TICK_SECONDS || "3", 10),
  llmApiKey: process.env.LLM_API_KEY || "",
  llmModel: process.env.LLM_MODEL || "claude-sonnet-5",
  mail: {
    smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
    smtpPort: parseInt(process.env.SMTP_PORT || "465", 10),
    smtpUser: process.env.SMTP_USER || "",
    smtpPass: process.env.SMTP_PASS || "",
    alertTo: (process.env.ALERT_TO || process.env.SMTP_USER || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    threshold: parseInt(process.env.HEALTH_ALERT_THRESHOLD || "80", 10),
    clear: parseInt(process.env.HEALTH_ALERT_CLEAR || "82", 10),
  },
  labx: {
    apiUrl: process.env.LABX_API_URL || "",
    apiKey: process.env.LABX_API_KEY || "",
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY || "",
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    baseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
  },
};

// Classification thresholds - standardised (fixes the deck's inconsistency).
export const THRESHOLDS = { healthy: 70, warning: 40 }; // >=70 Healthy, >=40 Warning, else Critical

export function classify(health) {
  if (health >= THRESHOLDS.healthy) return "Healthy";
  if (health >= THRESHOLDS.warning) return "Warning";
  return "Critical";
}
