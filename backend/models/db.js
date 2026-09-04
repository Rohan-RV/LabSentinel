/**
 * MongoDB connection with graceful degradation. If Mongo is unreachable the app
 * still runs fully (readings aren't persisted and memory falls back to an
 * in-process store) so the demo never dies on a missing database.
 *
 * Collections: devices, readings, events, maintenance_history, work_orders.
 */
import { MongoClient } from "mongodb";
import { config } from "../config.js";

let client = null;
let db = null;
let ready = false;

export async function connectMongo() {
  try {
    client = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 2500 });
    await client.connect();
    db = client.db(config.mongoDb);
    await db.command({ ping: 1 });
    ready = true;

    await db.collection("readings").createIndex({ device_id: 1, timestamp: -1 });
    await db.collection("events").createIndex({ timestamp: -1 });
    await db.collection("maintenance_history").createIndex({ deviceId: 1, timestamp: -1 });
    console.log(`[db] connected to MongoDB ${config.mongoUri}/${config.mongoDb}`);
  } catch (err) {
    ready = false;
    console.warn(
      `[db] MongoDB unavailable (${err.message}). Running WITHOUT persistence; ` +
        `maintenance memory uses an in-memory store.`
    );
  }
  return ready;
}

export function mongoReady() {
  return ready;
}

export function collection(name) {
  return ready && db ? db.collection(name) : null;
}

export async function closeMongo() {
  if (client) await client.close();
}
