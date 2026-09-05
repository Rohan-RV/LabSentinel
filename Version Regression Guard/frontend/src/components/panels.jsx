import React from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const AXIS = "#6b7a95";
const GRID = "#263149";

export const STAGES = [
  { id: "diff", label: "Git diff", hint: "what changed" },
  { id: "ast", label: "Tree-sitter / AST", hint: "what it means structurally" },
  { id: "graph", label: "Dependency graph", hint: "what depends on it (blast radius)" },
  { id: "impact", label: "Impact analysis", hint: "how much could it matter" },
  { id: "twin", label: "Digital twin", hint: "run both versions on identical samples" },
  { id: "comparison", label: "Comparison engine", hint: "deterministic V1 vs V2, no LLM" },
  { id: "regression", label: "Regression engine", hint: "GREEN / YELLOW / RED" },
  { id: "correlation", label: "Correlation", hint: "change ⟷ observed behavior (association)" },
  { id: "agent", label: "AI agent", hint: "explains, recommends, does not decide" },
  { id: "report", label: "Report", hint: "validation report" },
  { id: "gate", label: "Deployment gate", hint: "block / review / await approval" },
];

// Live vertical pipeline. Each stage shows pending -> running -> done with the
// real one-line result streamed from the backend.
export function PipelineFlow({ state, verdict }) {
  return (
    <div className="card full">
      <h3>Validation Pipeline (live)</h3>
      <div className="timeline">
        {STAGES.map((s, i) => {
          const st = state[s.id] || { status: "pending" };
          let color = "";
          if (s.id === "regression" || s.id === "gate") {
            if (st.status === "done" && verdict) color = ` v-${verdict}`;
          }
          return (
            <div className={`tl-step ${st.status}${color}`} key={s.id}>
              <div className="tl-marker">
                <span className="tl-dot">
                  {st.status === "done" ? "✓" : st.status === "running" ? "" : i + 1}
                </span>
                {i < STAGES.length - 1 && <span className="tl-rail" />}
              </div>
              <div className="tl-body">
                <div className="tl-head">
                  <span className="tl-label">{s.label}</span>
                  <span className="tl-hint">{s.hint}</span>
                  {st.status === "running" && <span className="spinner tl-spin" />}
                  {st.status === "done" && <span className="tl-badge">done</span>}
                </div>
                {st.summary && <div className="tl-summary">{st.summary}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function VerdictBanner({ result, onApprove, onBlock, gateMsg }) {
  const v = result.regression.overall;
  const gate = result.gate;
  const desc = {
    GREEN: "Candidate is same-or-better than baseline. Awaiting human approval.",
    YELLOW: "Non-blocking concerns detected. Engineer review required.",
    RED: "Regression detected. Deployment is blocked.",
  }[v];
  return (
    <div className={`card verdict ${v}`}>
      <div className={`light ${v}`} />
      <div>
        <div className="headline">
          Decision: <span className={`v-${v}`}>{v}</span>
        </div>
        <div className="desc">{desc}</div>
        <div className="desc mono" style={{ marginTop: 6 }}>
          gate: {gate.action}{gateMsg ? `  ·  ${gateMsg}` : ""}
        </div>
      </div>
      <div className="gate-actions">
        {v === "GREEN" && <button className="btn green" onClick={onApprove}>Approve &amp; deploy</button>}
        {v !== "GREEN" && <button className="btn red" onClick={onBlock}>Keep blocked</button>}
      </div>
    </div>
  );
}

export function ImpactCard({ impact }) {
  return (
    <div className="card">
      <h3>Impact Analysis (pre-test triage)</h3>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <span className={`tier ${impact.tier}`}>{impact.tier}</span>
        <span className="mono" style={{ color: "var(--faint)" }}>score {impact.score}</span>
      </div>
      <div style={{ color: "var(--muted)" }}>{impact.rationale}</div>
      <div style={{ marginTop: 10 }}>
        <span style={{ color: "var(--faint)" }}>Potentially affected: </span>
        {impact.affected_workflows.length
          ? impact.affected_workflows.join(", ")
          : "none detected"}
      </div>
    </div>
  );
}

export function DiffPanel({ diff, ast }) {
  return (
    <div className="card">
      <h3>Source / Artifact Diff + Structure</h3>
      {diff.files_changed.map((f) => (
        <div className="filerow" key={f.path}>
          <span className="mono">{f.path}</span>
          <span>
            {f.binary && <span className="badge-bin" style={{ marginRight: 8 }}>binary</span>}
            <span className={`status-${f.status}`}>{f.status}</span>
            {!f.binary && (
              <span className="mono" style={{ color: "var(--faint)", marginLeft: 8 }}>
                +{f.added_lines} −{f.removed_lines}
              </span>
            )}
          </span>
        </div>
      ))}

      <h3 style={{ marginTop: 16 }}>Tree-sitter / AST findings</h3>
      {ast.structural_changes.length === 0 && (
        <div style={{ color: "var(--faint)" }}>
          No source-level structural changes.
          {ast.notes.length ? " " + ast.notes[0] : ""}
        </div>
      )}
      {ast.structural_changes.map((c, i) => (
        <div className="struct" key={i}>
          <div className="kind">{c.kind.replace(/_/g, " ")}</div>
          <div className="mono">{c.detail}</div>
        </div>
      ))}
      {ast.notes.map((n, i) => (
        <div key={i} style={{ color: "var(--faint)", fontSize: 12, marginTop: 6 }}>ℹ {n}</div>
      ))}

      {Object.keys(diff.unified_diffs || {}).length > 0 && (
        <details>
          <summary>Show unified diff</summary>
          {Object.entries(diff.unified_diffs).map(([path, text]) => (
            <div key={path} style={{ marginTop: 8 }}>
              <div className="mono" style={{ color: "var(--faint)", fontSize: 11 }}>{path}</div>
              <pre className="diffbox">{renderDiff(text)}</pre>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function renderDiff(text) {
  return text.split("\n").map((line, i) => {
    let cls = "";
    if (line.startsWith("+") && !line.startsWith("+++")) cls = "add";
    else if (line.startsWith("-") && !line.startsWith("---")) cls = "del";
    else if (line.startsWith("@@")) cls = "hunk";
    return <div key={i} className={cls}>{line || " "}</div>;
  });
}

function shortLabel(n) {
  return n.workflow ? n.workflow : n.id.split("/").pop();
}
function nodeTag(n) {
  if (n.is_changed) return "CHANGED";
  return n.workflow ? "WORKFLOW" : "MODULE";
}
function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Node-link diagram: changed nodes on the left, connector lines fanning out to
// every potentially-affected node on the right. Drawn as SVG so it never wraps
// or leaves a dangling arrow.
export function BlastRadius({ graph }) {
  const changed = graph.nodes.filter((n) => n.is_changed);
  const affected = graph.nodes.filter((n) => n.is_affected);

  const NW = 200, NH = 44, GAP = 12, TOP = 26;
  const leftX = 6, rightX = leftX + NW + 92;
  const colH = (n) => Math.max(n * (NH + GAP) - GAP, NH);
  const H = Math.max(colH(changed.length), colH(affected.length || 1), NH);
  const svgW = rightX + NW + 6;
  const svgH = TOP + H + 8;

  const place = (arr, x) => {
    const start = TOP + (H - colH(arr.length)) / 2;
    return arr.map((n, i) => {
      const y = start + i * (NH + GAP);
      return { n, x, y, cx: x + NW, cyIn: y + NH / 2, cyOut: y + NH / 2 };
    });
  };
  const L = place(changed, leftX);
  const R = place(affected, rightX);

  const Node = ({ p, kind }) => {
    const stroke = kind === "changed" ? "#ef4d5a" : "#e5b035";
    const fill = kind === "changed" ? "rgba(239,77,90,0.14)" : "rgba(229,176,53,0.12)";
    const text = kind === "changed" ? "#ffd7db" : "#f6e3b6";
    return (
      <g>
        <title>{p.n.workflow || p.n.id}</title>
        <rect x={p.x} y={p.y} width={NW} height={NH} rx="9" fill={fill} stroke={stroke} />
        <text x={p.x + 12} y={p.y + 17} fill={stroke} fontSize="9" letterSpacing="0.6"
          fontFamily="ui-monospace, Menlo, Consolas, monospace">{nodeTag(p.n)}</text>
        <text x={p.x + 12} y={p.y + 33} fill={text} fontSize="13"
          fontFamily="ui-monospace, Menlo, Consolas, monospace">{truncate(shortLabel(p.n), 24)}</text>
      </g>
    );
  };

  return (
    <div className="card">
      <h3>Dependency Graph: Blast Radius</h3>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${svgW} ${svgH}`} width="100%" style={{ maxWidth: svgW, minWidth: 340 }}>
          <text x={leftX} y={16} fill="var(--faint)" fontSize="10" letterSpacing="0.6">CHANGED</text>
          <text x={rightX} y={16} fill="var(--faint)" fontSize="10" letterSpacing="0.6">
            POTENTIALLY AFFECTED
          </text>
          {L.map((lp, i) =>
            R.map((rp, j) => {
              const x1 = lp.cx, y1 = lp.cyOut, x2 = rp.x, y2 = rp.cyIn;
              return (
                <path key={`${i}-${j}`} d={`M ${x1} ${y1} C ${x1 + 46} ${y1}, ${x2 - 46} ${y2}, ${x2} ${y2}`}
                  fill="none" stroke="#3c4a68" strokeWidth="1.5" />
              );
            })
          )}
          {R.length === 0 && (
            <text x={rightX} y={TOP + H / 2} fill="var(--faint)" fontSize="12">nothing downstream</text>
          )}
          {L.map((p, i) => <Node key={`l${i}`} p={p} kind="changed" />)}
          {R.map((p, i) => <Node key={`r${i}`} p={p} kind="affected" />)}
        </svg>
      </div>
      <div style={{ color: "var(--faint)", fontSize: 12, marginTop: 10 }}>
        Reachable means <em>potentially</em> affected, not proven broken. The twin decides.
      </div>
    </div>
  );
}

export function TwinChart({ result }) {
  const arm = result.meta.arm;
  if (arm === "code") {
    const data = result.twin_table.map((r) => ({
      name: `${r.sample_id}·t${r.trial}`,
      Baseline: r.baseline_value,
      Candidate: r.candidate_value,
    }));
    return (
      <div className="card full">
        <h3>Digital Twin: same samples, {result.meta.trials} trials (V1 vs V2)</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: -8 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="name" stroke={AXIS} tick={{ fontSize: 10 }} interval={1} />
            <YAxis stroke={AXIS} tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
            <Tooltip contentStyle={{ background: "#0a0e16", border: "1px solid #263149", borderRadius: 8 }} />
            <Legend />
            <Line type="monotone" dataKey="Baseline" stroke="#4f8cff" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="Candidate" stroke="#ef4d5a" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
  // model arm: per-sample % deviation
  const tol = 3;
  const data = result.twin_table.map((r) => ({
    name: r.sample_id, deviation: r.pct_deviation, ok: r.within_tolerance,
  }));
  return (
    <div className="card full">
      <h3>Digital Twin: per-sample prediction drift (candidate vs baseline)</h3>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: -8 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="name" stroke={AXIS} tick={{ fontSize: 11 }} />
          <YAxis stroke={AXIS} tick={{ fontSize: 11 }} unit="%" />
          <Tooltip contentStyle={{ background: "#0a0e16", border: "1px solid #263149", borderRadius: 8 }} />
          <ReferenceLine y={tol} stroke="#e5b035" strokeDasharray="4 4"
            label={{ value: `tol ${tol}%`, fill: "#e5b035", fontSize: 11, position: "right" }} />
          <Bar dataKey="deviation" radius={[4, 4, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.ok ? "#2fbf71" : "#ef4d5a"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ComparisonTable({ comparison }) {
  return (
    <div className="card full">
      <h3>Deterministic Comparison (no LLM decides here)</h3>
      <table>
        <thead>
          <tr><th>Metric</th><th>Baseline</th><th>Candidate</th><th>Verdict</th><th>Detail</th></tr>
        </thead>
        <tbody>
          {comparison.rows.map((r) => (
            <tr key={r.metric}>
              <td>{r.label}{r.unit ? ` (${r.unit})` : ""}</td>
              <td className="num mono">{fmt(r.baseline)}</td>
              <td className="num mono">{fmt(r.candidate)}</td>
              <td><span className={`chip ${r.verdict}`}>{r.verdict}</span></td>
              <td style={{ color: "var(--muted)" }}>{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmt(v) {
  if (typeof v === "number") return Number.isInteger(v) ? v : v.toFixed(3);
  return v;
}

export function CorrelationPanel({ correlation }) {
  return (
    <div className="card">
      <h3>Correlation: change ⟷ observed behavior</h3>
      {correlation.statements.map((s, i) => (
        <div className="assoc" key={i}>
          <div className="obs">{s.observation}</div>
          <div className="link">
            associated with <span className="mono">{s.associated_component}</span>: {s.associated_change}
          </div>
          <div className="note">{s.note}</div>
        </div>
      ))}
    </div>
  );
}

export function AgentPanel({ agent }) {
  const feat = (label, items) =>
    items.length > 0 && (
      <div style={{ marginBottom: 8 }}>
        <span style={{ color: "var(--faint)" }}>{label}: </span>
        <span className="mono">{items.join("; ")}</span>
      </div>
    );
  return (
    <div className="card">
      <h3>AI Agent: explanation &amp; recommendation</h3>
      <div className="summary-line">{agent.natural_language_summary}</div>
      {feat("Added", agent.features_added)}
      {feat("Modified", agent.features_modified)}
      {feat("Removed", agent.features_removed)}
      {feat("Dependencies", agent.dependency_changes)}
      <div style={{ marginTop: 10 }}>
        <div style={{ color: "var(--faint)", marginBottom: 4 }}>Recommended investigation:</div>
        <ul className="list-plain">
          {agent.recommended_investigation.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      </div>
      <div style={{ color: "var(--faint)", fontSize: 11, marginTop: 10 }}>
        Agent recommendation: <b>{agent.recommendation}</b> · derived from the deterministic verdict,
        never overriding it · {agent.used_llm ? "phrased by LLM" : "deterministic phrasing (no LLM key set)"}
      </div>
    </div>
  );
}

export function ReportPanel({ report, alert }) {
  return (
    <div className="card full">
      <h3>Validation Report</h3>
      <pre className="report-text">{report.report_text}</pre>
      {alert && (
        <div className={`alertbox ${alert.verdict === "YELLOW" ? "warn" : ""}`} style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            ⚠ ALERT ({alert.severity}) → {alert.responsible_role} · {alert.channel}
          </div>
          <div className="kv"><span className="k">What changed</span><span>{alert.what_changed.join("; ")}</span></div>
          <div className="kv"><span className="k">What failed</span><span>{alert.what_failed.join(", ") || "none"}</span></div>
          <div className="kv"><span className="k">Affected workflows</span><span>{alert.affected_workflows.join(", ") || "none"}</span></div>
          <div className="kv"><span className="k">Deployment</span><span>{alert.deployment_status}</span></div>
        </div>
      )}
    </div>
  );
}
