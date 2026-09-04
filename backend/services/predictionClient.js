/**
 * Thin client for the Python FastAPI prediction service. Inference only - the
 * backend never trains. One batched /predict call scores the whole fleet per tick.
 */
import axios from "axios";
import { config } from "../config.js";

const http = axios.create({ baseURL: config.predictUrl, timeout: 8000 });

/**
 * @param {Array<Object>} readings feature objects ({air_temperature, ...}), nulls allowed
 * @returns {Promise<Array<{failure_probability:number, health_score:number, top_factors:Array}>>}
 */
export async function batchPredict(readings) {
  if (!readings.length) return [];
  const { data } = await http.post("/predict", { readings });
  return data.predictions;
}

export async function getModelMetrics() {
  const { data } = await http.get("/metrics");
  return data;
}

export async function predictionServiceUp() {
  try {
    await http.get("/health");
    return true;
  } catch {
    return false;
  }
}
