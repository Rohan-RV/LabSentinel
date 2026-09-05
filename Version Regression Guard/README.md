# AI Kavach

**Update-safety validation for scientific instruments.**
A standalone companion to LabSentinel. Where LabSentinel answers *"is this instrument
about to fail while running?"*, AI Kavach answers a different question:

> Before we install a new software / firmware / AI-model version on a real instrument,
> will it break, degrade, or silently change anything that currently works?

The principle it enforces: **V2 must be same-or-better than V1.** Nothing that works today
should regress because of an update.

This is its own project. It does not import or depend on LabSentinel.

---

## Why this exists

A lab took a vendor's updated AI/ML model on trust, installed it, and the model had subtly
drifted. It quietly changed the results of live research data. Nobody diffed it, nobody
A/B-tested it against the old version first. That is the exact failure this system is built
to prevent, for code updates and for model updates alike.

## The two arms (and why you need both)

| | Code / firmware update | AI-model update |
|---|---|---|
| Example | `calculate_pressure(raw)` → `calculate_pressure(raw, calibration_factor)` | vendor ships new `model.pkl` weights |
| Git diff sees | the exact line + signature change | "binary file changed" |
| Tree-sitter / AST sees | new parameter, changed signature | **nothing** (no source to parse) |
| What actually catches a bad one | static analysis *and* the twin | **only** the digital twin + comparison |

Static analysis is powerful for code and blind for model weights. Behavioral A/B testing in
the twin is the only thing that catches silent model drift. The system runs both and is
honest about which arm did the catching.

## The pipeline (what each stage is for)

```
V1 + V2
  → Git diff             what changed (real `git diff`)
  → Tree-sitter / AST    what it means structurally (functions, params, signatures)
  → Dependency graph     what depends on it → blast radius (networkx)
  → Impact analysis      what could be affected + LOW/MEDIUM/HIGH/CRITICAL
  → Digital twin         run BOTH versions on identical samples, safely, N trials
  → Comparison engine    deterministic V1-vs-V2 by configurable rules (NO LLM here)
  → Regression engine    GREEN / YELLOW / RED
  → Correlation          links a change to an observed regression as ASSOCIATION, not proof
  → AI agent             explains + recommends; never decides, never invents, never deploys
  → Report               the validation report
  → Deployment gate      GREEN→await human approval · YELLOW→review · RED→block + alert
```

The deterministic stages decide. The agent only explains. That separation is the whole point.

## Repo layout

```
backend/
  config.py            configurable tolerances / rules (per-instrument overridable)
  pipeline.py          orchestrates the 11 stages
  main.py              FastAPI service
  run_demo.py          CLI runner (no browser needed)
  stages/              one file per stage
fixtures/
  scenarios.json       the demo validations
  instruments/SCI-DEV-001/{v2.4, v2.4-clean, v2.5}   mock instrument code (code arm)
  models/QC-MODEL-07/{v1, v2-drift, v2-clean}         real trained models (model arm)
frontend/              React + Vite + Recharts dashboard
```

## The demo scenarios

| Instrument | Baseline → Candidate | Arm | Expected |
|---|---|---|---|
| SCI-DEV-001 | v2.4 → v2.5 | code | **RED**: adaptive-calibration change biases measurements ~5% |
| SCI-DEV-001 | v2.4 → v2.4-clean | code | **GREEN**: doc/tidy-only maintenance release |
| QC-MODEL-07 | v1 → v2-drift | model | **RED**: vendor model silently drifts ~6% |
| QC-MODEL-07 | v1 → v2-clean | model | **GREEN**: honest re-train, within tolerance |

## Running it

### 1. Backend (Python 3.10+)

```bash
cd backend
pip install -r requirements.txt

# (re)build the model fixtures once, creates the .pkl files
python ../fixtures/models/QC-MODEL-07/build_models.py

# option A: run the whole demo in the terminal
python run_demo.py --all

# option B: start the API for the dashboard
uvicorn main:app --reload --port 8000
```

### 2. Frontend (Node 18+)

```bash
cd frontend
npm install
npm run dev        # opens http://localhost:5173, proxies /api to :8000
```

Pick a validation on the left, set the number of trials, hit **Run validation**.

### Optional: LLM phrasing for the agent

By default the agent writes its summary deterministically (no key needed, never crashes).
Set `LLM_API_KEY` (and optionally `LLM_MODEL`) to have an LLM phrase the *same facts*, it
still cannot change the verdict or invent anything.

```bash
export LLM_API_KEY=sk-...      # optional
```

## How it fits the LabSentinel story

LabSentinel protects an instrument at **runtime**. AI Kavach protects it at
**update time**. Same mission (keep the science reliable, no disruptions), opposite end of
the lifecycle. Built separately so each stays simple and neither can break the other.

## Design choices worth defending to a judge

- **The LLM never decides.** Every pass/fail is a configurable numeric rule you can read.
- **Correlation is association, not causation.** We ran a black-box A/B test, not a
  per-line ablation, so we say a regression is *associated with* a changed component.
- **A human still holds the deploy button.** Even GREEN only means "awaiting approval."
- **Tolerances are per-instrument.** A chromatograph and a concentration model do not share
  an acceptable-drift number, and `config.py` reflects that.
