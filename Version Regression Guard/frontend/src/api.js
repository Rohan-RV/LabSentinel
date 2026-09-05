// Thin API client. Paths are relative so Vite's dev proxy forwards them to
// the FastAPI backend (see vite.config.js).

export async function getScenarios() {
  const res = await fetch("/api/scenarios");
  if (!res.ok) throw new Error("failed to load scenarios");
  return res.json();
}

// One-shot (used as a fallback / for testing). The UI prefers streamValidation.
export async function runValidation({ instrument, baseline, candidate, trials }) {
  const res = await fetch("/api/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instrument, baseline, candidate, trials }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || "validation failed");
  }
  return res.json();
}

// Live stream of the pipeline via Server-Sent Events. Calls onEvent for every
// stage event, onDone(payload) when the final result arrives, onError(msg) on
// failure. Returns a cancel function.
export function streamValidation({ instrument, baseline, candidate, trials }, { onEvent, onDone, onError }) {
  const qs = new URLSearchParams({ instrument, baseline, candidate });
  if (trials) qs.set("trials", String(trials));
  const es = new EventSource(`/api/validate/stream?${qs.toString()}`);

  es.onmessage = (e) => {
    let ev;
    try {
      ev = JSON.parse(e.data);
    } catch {
      return;
    }
    if (ev.stage === "complete") {
      es.close();
      onDone && onDone(ev.payload);
    } else if (ev.stage === "error") {
      es.close();
      onError && onError(ev.message || "pipeline error");
    } else {
      onEvent && onEvent(ev);
    }
  };
  es.onerror = () => {
    es.close();
    onError && onError("stream connection lost (is the backend running on port 8000?)");
  };

  return () => es.close();
}
