/**
 * Document shapes for the MongoDB collections. We use the native `mongodb`
 * driver (no Mongoose) so these are JSDoc typedefs + small factories that keep
 * the persisted documents consistent.
 */

/**
 * @typedef {Object} Device        // collection: devices
 * @property {string} id
 * @property {string} type
 * @property {number} criticality  // 1-5
 * @property {string[]} reports     // sensor subset this device reports
 * @property {number} active_dependents
 * @property {boolean} backup_available
 * @property {string} location
 */

/**
 * @typedef {Object} Reading       // collection: readings
 * @property {string} device_id
 * @property {string} timestamp    // ISO
 * @property {Object} readings     // {air_temperature, process_temperature, ...} nulls allowed
 * @property {number} failure_probability
 * @property {number} health       // 0-100 (smoothed)
 * @property {string} status       // Healthy | Warning | Critical
 * @property {number} confidence
 */

/**
 * @typedef {Object} MaintenanceRecord   // collection: maintenance_history
 * @property {string} deviceId
 * @property {string} timestamp
 * @property {Object} symptom_snapshot
 * @property {string} failure_mode
 * @property {string} action_taken
 * @property {string[]} parts_replaced
 * @property {string} resolution
 */

export function deviceDoc(inst) {
  return {
    id: inst.id,
    type: inst.type,
    criticality: inst.criticality,
    reports: inst.reports,
    active_dependents: inst.active_dependents,
    backup_available: inst.backup_available,
    location: inst.location,
  };
}

export function readingDoc(state) {
  return {
    device_id: state.id,
    timestamp: state.lastReading?.timestamp || new Date().toISOString(),
    readings: state.lastReading?.readings || {},
    failure_probability: state.failure_probability,
    health: state.health,
    status: state.status,
    confidence: state.confidence,
  };
}
