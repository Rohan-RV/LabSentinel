/**
 * LabSentinel backend entrypoint. Express REST + Socket.IO real-time push over
 * the FleetManager scoring loop. Starts even if MongoDB or the prediction
 * service are down (degrades gracefully) so the demo never dies.
 */
import express from "express";
import cors from "cors";
import http from "http";
import fs from "fs";
import { Server as SocketServer } from "socket.io";

import { config, ARTIFACTS } from "./config.js";
import { connectMongo } from "./models/db.js";
import { seedMemory, getHistory } from "./services/memory.js";
import { getModelMetrics, predictionServiceUp } from "./services/predictionClient.js";
import { verifyMailer } from "./services/mailer.js";
import { FleetManager } from "./fleet.js";
import { analyzeLog } from "./services/logAnalyzer.js";
import { simulateTwin } from "./services/twin.js";
import { composeReport } from "./services/report.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: "*" } });

const fleet = new FleetManager(io);
let cachedMetrics = null;
let rulMetrics = null;

function loadRulMetrics() {
  try {
    const raw = fs.readFileSync(`${ARTIFACTS}/rul_metrics.json`, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---- REST API ----
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", ...fleet.meta() });
});

app.get("/api/fleet", (req, res) => {
  res.json(fleet.snapshot());
});

app.get("/api/metrics", async (req, res) => {
  try {
    if (!cachedMetrics) cachedMetrics = await getModelMetrics();
    res.json(cachedMetrics);
  } catch (err) {
    res.status(503).json({ error: "prediction service unavailable", detail: err.message });
  }
});

app.get("/api/rul-metrics", (req, res) => {
  if (!rulMetrics) return res.status(503).json({ error: "RUL metrics unavailable" });
  res.json(rulMetrics);
});

app.get("/api/alerts", (req, res) => {
  res.json(fleet.recentEvents(Number(req.query.limit) || 50));
});

app.get("/api/devices/:id", async (req, res) => {
  const d = fleet.deviceDetail(req.params.id);
  if (!d) return res.status(404).json({ error: "device not found" });
  const memory = await getHistory(req.params.id);
  res.json({ ...d, memory });
});

app.post("/api/twin/:id/simulate", async (req, res) => {
  try {
    const b = req.body || {};
    const steps = Math.max(10, Math.min(80, parseInt(b.steps ?? 40, 10) || 40));
    const load_factor = Math.max(0.5, Math.min(1.5, Number(b.load_factor ?? 1.0) || 1.0));
    const ambient_offset = Math.max(-8, Math.min(8, Number(b.ambient_offset ?? 0) || 0));
    const result = await simulateTwin(fleet, req.params.id, { steps, load_factor, ambient_offset });
    res.json(result);
  } catch (err) {
    res.status(err.message === "device not found" ? 404 : 400).json({ error: err.message });
  }
});

app.post("/api/analyze-log", async (req, res) => {
  try {
    const { content, filename } = req.body || {};
    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "missing file content" });
    }
    const result = await analyzeLog({ content, filename });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/devices/:id/report", async (req, res) => {
  const d = fleet.deviceDetail(req.params.id);
  if (!d) return res.status(404).json({ error: "device not found" });
  const memory = await getHistory(req.params.id);
  const rep = await composeReport(d, memory);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${rep.filename}"`);
  res.send(rep.pdf);
});

app.post("/api/simulate-failure/:id", (req, res) => {
  const ok = fleet.triggerFailure(req.params.id);
  if (!ok) return res.status(404).json({ error: "device not found" });
  res.json({ ok: true, device_id: req.params.id, message: "failure ramp started" });
});

app.post("/api/devices/:id/order-parts", async (req, res) => {
  const order = await fleet.orderParts(req.params.id);
  if (!order) return res.status(404).json({ error: "device not found" });
  res.json(order);
});

app.post("/api/devices/:id/resolve", async (req, res) => {
  const ok = await fleet.resolveDevice(req.params.id);
  if (!ok) return res.status(404).json({ error: "device not found" });
  res.json({ ok: true, device_id: req.params.id, message: "device reset to normal" });
});

// ---- Socket.IO ----
io.on("connection", (socket) => {
  socket.emit("fleet:update", fleet.snapshot());
  if (cachedMetrics) socket.emit("model:metrics", cachedMetrics);
  if (rulMetrics) socket.emit("rul:metrics", rulMetrics);
});

// ---- startup ----
async function main() {
  await connectMongo();
  await seedMemory();
  await verifyMailer();
  rulMetrics = loadRulMetrics();
  if (rulMetrics) {
    io.emit("rul:metrics", rulMetrics);
    console.log(`[server] RUL model loaded (C-MAPSS RMSE ${rulMetrics.rmse} cycles)`);
  } else {
    console.warn("[server] rul_metrics.json not found - run: cd model && python train_rul.py");
  }
  await fleet.persistDevices();

  try {
    cachedMetrics = await getModelMetrics();
    io.emit("model:metrics", cachedMetrics);
  } catch {
    console.warn("[server] model metrics not available yet (prediction service down?)");
  }

  const up = await predictionServiceUp();
  if (!up) {
    console.warn(
      "[server] prediction service not reachable at " +
        config.predictUrl +
        " - start it with: cd model && uvicorn serve:app --port 8000"
    );
  }

  server.listen(config.port, () => {
    console.log(`[server] LabSentinel backend on http://localhost:${config.port}`);
    fleet.start();
  });
}

main();

process.on("SIGINT", () => {
  fleet.stop();
  process.exit(0);
});
