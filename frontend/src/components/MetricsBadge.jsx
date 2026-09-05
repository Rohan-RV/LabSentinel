import { useState } from "react";

/** Shows the honest failure-class metrics from the trained model. */
export default function MetricsBadge({ metrics }) {
  const [open, setOpen] = useState(false);
  if (!metrics || !metrics.failure_class) {
    return <span className="text-xs text-slate-500">model metrics loading…</span>;
  }
  const fc = metrics.failure_class;
  const pct = (x) => `${Math.round(x * 100)}%`;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
        title="Trained once, offline, on AI4I 2020. Live app runs inference only."
      >
        Model · recall {pct(fc.recall)} · F1 {fc.f1} · PR-AUC {fc.pr_auc}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-ink-500 bg-ink-800 p-4 text-xs shadow-2xl">
          <div className="mb-2 font-semibold text-slate-200">{metrics.model}</div>
          <div className="mb-3 text-slate-400">{metrics.dataset}</div>
          <table className="w-full text-slate-300">
            <tbody>
              <Row k="Precision (failure)" v={pct(fc.precision)} />
              <Row k="Recall (failure)" v={pct(fc.recall)} />
              <Row k="F1 (failure)" v={fc.f1} />
              <Row k="PR-AUC" v={fc.pr_auc} />
              <Row k="ROC-AUC" v={fc.roc_auc} />
              <Row k="Failure rate" v={pct(metrics.failure_rate)} />
            </tbody>
          </table>
          <p className="mt-3 leading-relaxed text-slate-500">
            Accuracy is omitted on purpose - the data is ~3.4% failures, so accuracy
            is a trap. Trained once offline; the live app only runs inference.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }) {
  return (
    <tr className="border-t border-ink-600/60">
      <td className="py-1 text-slate-400">{k}</td>
      <td className="py-1 text-right font-mono font-semibold text-slate-100">{v}</td>
    </tr>
  );
}
``