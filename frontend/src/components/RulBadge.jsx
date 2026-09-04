import { useState } from "react";

/** C-MAPSS RUL model benchmark (trained offline on real run-to-failure data). */
export default function RulBadge({ metrics }) {
  const [open, setOpen] = useState(false);
  if (!metrics || metrics.rmse === undefined) {
    return <span className="text-xs text-slate-500">RUL model loading...</span>;
  }
  const samples = metrics.samples || [];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20"
        title="Remaining Useful Life regressor, benchmarked offline on NASA C-MAPSS FD001. The live fleet shows a projected time-to-failure from each device's trend."
      >
        RUL · RMSE {metrics.rmse} cyc · R2 {metrics.r2}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-ink-500 bg-ink-800 p-4 text-xs shadow-2xl">
          <div className="mb-2 font-semibold text-slate-200">Remaining Useful Life model</div>
          <div className="mb-3 text-slate-400">{metrics.dataset}</div>
          <table className="w-full text-slate-300">
            <tbody>
              <Row k="RMSE (cycles)" v={metrics.rmse} />
              <Row k="MAE (cycles)" v={metrics.mae} />
              <Row k="R2" v={metrics.r2} />
              <Row k="NASA score" v={metrics.nasa_score} />
              <Row k="Test engines" v={metrics.n_test_units} />
            </tbody>
          </table>
          {samples.length > 0 && (
            <>
              <div className="mt-3 mb-1 text-[10px] uppercase tracking-wide text-slate-500">
                Sample predictions (predicted / actual cycles)
              </div>
              <table className="w-full text-slate-300">
                <tbody>
                  {samples.slice(0, 6).map((s) => (
                    <tr key={s.unit} className="border-t border-ink-600/60">
                      <td className="py-1 text-slate-400">Engine #{s.unit}</td>
                      <td className="py-1 text-right font-mono text-slate-100">
                        {s.predicted} / {s.actual}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <p className="mt-3 leading-relaxed text-slate-500">
            Trained once offline on real turbofan run-to-failure data. The live fleet
            shows an estimated time-to-failure projected from each device's own trend.
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
