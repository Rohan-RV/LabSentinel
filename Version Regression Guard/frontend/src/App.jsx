import React, { useEffect, useRef, useState } from "react";
import { getScenarios, runValidation, streamValidation } from "./api";
import {
  AgentPanel, BlastRadius, ComparisonTable, CorrelationPanel, DiffPanel,
  ImpactCard, PipelineFlow, ReportPanel, STAGES, TwinChart, VerdictBanner,
} from "./components/panels.jsx";

const emptyStages = () =>
  Object.fromEntries(STAGES.map((s) => [s.id, { status: "pending" }]));

export default function App() {
  const [scenarios, setScenarios] = useState([]);
  const [selected, setSelected] = useState(null);
  const [trials, setTrials] = useState(10);
  const [result, setResult] = useState(null);          // accumulates as stages stream
  const [stageState, setStageState] = useState(emptyStages());
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState(null);
  const [gateMsg, setGateMsg] = useState("");
  const cancelRef = useRef(null);

  useEffect(() => {
    getScenarios()
      .then((d) => {
        setScenarios(d.validations);
        setSelected(d.validations[0] || null);
      })
      .catch((e) => setError(e.message));
    return () => cancelRef.current && cancelRef.current();
  }, []);

  function run() {
    if (!selected) return;
    if (cancelRef.current) cancelRef.current();
    setRunning(true);
    setStarted(true);
    setError(null);
    setGateMsg("");
    setResult({});
    setStageState(emptyStages());

    const params = {
      instrument: selected.instrument,
      baseline: selected.baseline,
      candidate: selected.candidate,
      trials: Number(trials),
    };
    let completed = false;

    // Safety net: if the live stream fails for any reason, fall back to a
    // single request and render the full result so the demo never dies.
    async function fallback(msg) {
      try {
        const payload = await runValidation(params);
        setResult(payload);
        setStageState(Object.fromEntries(STAGES.map((s) => [s.id, { status: "done" }])));
        setRunning(false);
      } catch (e) {
        setError(`${msg} / fallback also failed: ${e.message}`);
        setRunning(false);
      }
    }

    cancelRef.current = streamValidation(params, {
      onEvent: (ev) => {
        if (ev.stage && ev.stage !== "meta") {
          setStageState((prev) => ({
            ...prev,
            [ev.stage]: { status: ev.status, summary: ev.summary || prev[ev.stage]?.summary },
          }));
        }
        if (ev.patch) setResult((prev) => ({ ...prev, ...ev.patch }));
      },
      onDone: (payload) => {
        completed = true;
        setResult(payload);
        setRunning(false);
      },
      onError: (msg) => {
        if (completed) return; // stream already finished; ignore late close
        fallback(msg);
      },
    });
  }

  const r = result || {};
  const verdict = r.regression && r.regression.overall;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">AK</div>
          <div>
            <h1>AI Kavach</h1>
            <div className="sub">Update-safety validation · LabSentinel family</div>
          </div>
        </div>

        <div className="section-label">Validations</div>
        {scenarios.map((s) => (
          <div
            key={s.id}
            className={`scenario ${selected && selected.id === s.id ? "active" : ""}`}
            onClick={() => { if (!running) { setSelected(s); setStarted(false); setError(null); } }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span className="title">{s.instrument}</span>
              <span className="arm">{s.arm}</span>
            </div>
            <div className="meta">{s.baseline} → {s.candidate}</div>
            <div className="meta">{s.title}</div>
          </div>
        ))}

        <div className="controls">
          <div>
            <label>Trials (A/B repetitions)</label>
            <input type="number" min="1" max="50" value={trials} disabled={running}
              onChange={(e) => setTrials(e.target.value)} />
          </div>
          <button className="btn" onClick={run} disabled={running || !selected}>
            {running ? <><span className="spinner" /> Running pipeline…</> : "Run validation"}
          </button>
        </div>

        <div className="section-label">Pipeline</div>
        <div className="legend">
          {STAGES.map((s, i) => (
            <div className="legend-row" key={s.id}>
              <span className="legend-num">{i + 1}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </aside>

      <main className="main">
        <h2>Software / Firmware / Model Update Validation</h2>
        <p className="lede">
          Prove a candidate version is <b>same-or-better</b> than the deployed one before it touches a
          real instrument. Watch each stage run live below.
        </p>

        {error && <div className="error">Error: {error}</div>}

        {!started && !error && (
          <div className="empty">
            <div>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🛡️</div>
              <div className="big">Pick a validation on the left and hit <b>Run validation</b>.</div>
              <div style={{ marginTop: 6 }}>
                The 11-stage pipeline runs live: static analysis finds what changed, the digital
                twin proves what it does.
              </div>
            </div>
          </div>
        )}

        {started && (
          <>
            {verdict && r.gate && (
              <VerdictBanner
                result={r}
                gateMsg={gateMsg}
                onApprove={() => setGateMsg("Deployment approved and logged (simulated).")}
                onBlock={() => setGateMsg("Deployment kept blocked; team notified (simulated).")}
              />
            )}

            <PipelineFlow state={stageState} verdict={verdict} />

            <div className="grid">
              {r.impact && <ImpactCard impact={r.impact} />}
              {r.graph && <BlastRadius graph={r.graph} />}
              {r.diff && r.ast && <DiffPanel diff={r.diff} ast={r.ast} />}
              {r.correlation && <CorrelationPanel correlation={r.correlation} />}
            </div>
            {r.twin_table && r.meta && r.comparison && <TwinChart result={r} />}
            {r.comparison && <ComparisonTable comparison={r.comparison} />}
            {r.agent && <div className="grid"><AgentPanel agent={r.agent} /></div>}
            {r.report && <ReportPanel report={r.report} alert={r.alert} />}
          </>
        )}
      </main>
    </div>
  );
}
