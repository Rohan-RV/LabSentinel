import { useRef, useState } from "react";
import { analyzeLog } from "../api";

/** Header control: upload a finite device log file for a one-shot analysis. */
export default function LogUpload({ onResult }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      const content = await file.text();
      const result = await analyzeLog({ content, filename: file.name });
      onResult(result);
    } catch (e2) {
      setErr(e2.message || "analysis failed");
      setTimeout(() => setErr(""), 6000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => inputRef.current && inputRef.current.click()}
        disabled={busy}
        className="flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-60"
        title="Upload a device log file (JSON-lines, JSON, or CSV) for a one-shot analysis"
      >
        <span>{busy ? "Analyzing..." : "Analyze log file"}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".jsonl,.json,.csv,.txt,.log"
        className="hidden"
        onChange={onFile}
      />
      {err && (
        <div className="absolute right-0 z-40 mt-2 w-72 rounded-lg border border-critical/40 bg-critical/10 px-3 py-2 text-xs text-critical shadow-xl">
          {err}
        </div>
      )}
    </div>
  );
}
