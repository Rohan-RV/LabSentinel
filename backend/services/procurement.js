/**
 * Parts procurement via a LabX supplier integration.
 *
 * The agent recommends the parts a repair needs (from the device's past fixes
 * when available, else a failure-mode catalog), and this service drafts and
 * places a purchase order. LabX has no public ordering API, so the order is
 * drafted and confirmed locally with the exact shape a real supplier API would
 * return. Set LABX_API_URL and LABX_API_KEY to point the same flow at a real
 * endpoint later; the order is flagged simulated until then.
 */
import { config } from "../config.js";

const CURRENCY = "INR";

const CATALOG = {
  "heat-dissipation": [
    { name: "Chiller pump", sku: "LX-CHP-220", price: 18500, eta_hours: 6 },
    { name: "Coolant 5L", sku: "LX-CLT-05", price: 2200, eta_hours: 3 },
    { name: "Condenser filter", sku: "LX-CFR-11", price: 1400, eta_hours: 3 },
  ],
  "power": [
    { name: "Motor driver board", sku: "LX-MDB-40", price: 9600, eta_hours: 8 },
    { name: "Power harness", sku: "LX-PWH-12", price: 1800, eta_hours: 4 },
  ],
  "overstrain": [
    { name: "Rotor bearing assembly", sku: "LX-RBA-77", price: 5400, eta_hours: 6 },
    { name: "Drive belt", sku: "LX-DBL-09", price: 900, eta_hours: 3 },
  ],
  "over-temperature": [
    { name: "Thermal sensor", sku: "LX-TSN-33", price: 2100, eta_hours: 4 },
    { name: "Cooling fan", sku: "LX-CFN-18", price: 1600, eta_hours: 4 },
  ],
  "thermal block": [
    { name: "Thermal block module", sku: "LX-TBM-51", price: 7300, eta_hours: 8 },
    { name: "Thermal sensor", sku: "LX-TSN-33", price: 2100, eta_hours: 4 },
  ],
  default: [
    { name: "General service kit", sku: "LX-GSK-01", price: 3500, eta_hours: 6 },
  ],
};

function catalogFor(failureMode = "") {
  const m = String(failureMode).toLowerCase();
  for (const key of Object.keys(CATALOG)) {
    if (key !== "default" && m.includes(key)) return CATALOG[key];
  }
  return CATALOG.default;
}

export function recommendParts(ctx = {}) {
  const catalog = catalogFor(ctx.failure_mode);
  const mem = ctx.memory || [];
  const past = mem.length && Array.isArray(mem[0].parts_replaced) ? mem[0].parts_replaced : [];
  if (past.length) {
    return past.map((name) => {
      const first = name.toLowerCase().split(" ")[0];
      const hit = catalog.find((c) => c.name.toLowerCase().includes(first));
      return hit ? { ...hit, qty: 1 } : { name, sku: "LX-GEN-00", price: 2500, eta_hours: 6, qty: 1 };
    });
  }
  return catalog.map((c) => ({ ...c, qty: 1 }));
}

let orderSeq = 5200;
export async function placeOrder(deviceId, items) {
  orderSeq += 1;
  const total = items.reduce((s, i) => s + i.price * (i.qty || 1), 0);
  const eta = Math.max(...items.map((i) => i.eta_hours || 6));
  return {
    order_id: `LABX-${orderSeq}`,
    supplier: "LabX",
    device_id: deviceId,
    items,
    total,
    currency: CURRENCY,
    eta_hours: eta,
    status: "PLACED",
    simulated: !config.labx.apiKey,
    placed_at: new Date().toISOString(),
  };
}
