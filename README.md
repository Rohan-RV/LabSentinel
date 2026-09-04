# LabSentinel - Real-Time Predictive Maintenance

LabSentinel monitors a **fleet of scientific & hospital instruments** in real time. It
streams sensor readings from every device, scores each device's failure risk with a
**trained XGBoost model**, converts that to a 0–100 health score, classifies devices
**Healthy / Warning / Critical**, and layers on an **Impact Engine**, per-device
**Maintenance Memory**, and an **Autonomous Agent** that explains and acts.

> **Core principle:** the model is trained **once, offline**. In the live app it only runs
> **inference** (microseconds per reading). It is never retrained on live logs.

```
Sensor logs (simulated)
  → XGBoost inference (failure probability)
  → Health score + explainable factors  → Impact Engine (operational priority)
  → Memory (past incidents)             → Agent (diagnosis + action + plain language)
  → Dashboard + simulated work order    → resolution stored back into Memory
```

---

## Architecture

| Layer | Tech | Folder |
|---|---|---|
| Model / training / inference | Python, XGBoost, scikit-learn, FastAPI | `model/` |
| Backend / fleet loop / real-time | Node.js, Express, Socket.IO, MongoDB | `backend/` |
| Frontend / dashboard | React, Tailwind, Recharts, socket.io-client | `frontend/` |

Three services run together:

1. **Prediction service** (FastAPI, port `8000`) - loads the trained model, exposes
   `POST /predict` and `GET /metrics`. Inference only.
2. **Backend** (Express + Socket.IO, port `4000`) - runs the live tick loop: simulate
   readings → batch-predict → envelope guard → health/EMA/classify → impact → memory →
   agent → persist to Mongo → push to the UI.
3. **Frontend** (Vite dev server, port `5173`) - the live dashboard.

---

## Prerequisites

- **Python 3.10+** (developed on 3.14)
- **Node.js 18+** (developed on 24)
- **MongoDB** running locally on `27017` *(optional - the app runs without it, but
  persistence and stored memory are disabled; seeded memory still works in-process)*
- Internet on first `train.py` run to fetch the AI4I 2020 dataset (a no-network fallback
  is documented below).

---

## Setup & run (all three services)

### 1) Model - train once, then serve

```bash
cd model
python -m venv .venv
# Windows PowerShell:  .venv\Scripts\Activate.ps1
# Windows Git Bash:    source .venv/Scripts/activate
# macOS/Linux:         source .venv/bin/activate
pip install -r requirements.txt

python train.py            # fetches AI4I 2020, trains XGBoost, writes artifacts/ + honest metrics
python roster.py           # builds the 38-device fleet -> config/instances.json
python simulate.py --history   # writes per-device historical logs -> data/logs/*.jsonl

# start the inference service (keep this terminal open)
python serve.py            # FastAPI on http://localhost:8000
```

> **No network for `train.py`?** Download `ai4i2020.csv` from
> <https://archive.ics.uci.edu/dataset/601/ai4i+2020+predictive+maintenance+dataset>,
> drop it in `model/data/`, and re-run `python train.py`.

### 2) Backend

```bash
cd backend
npm install
cp .env.example .env       # defaults work out of the box
npm start                  # Express + Socket.IO on http://localhost:4000
```

### 3) Frontend

```bash
cd frontend
npm install
npm run dev                # dashboard on http://localhost:5173
```

Open **http://localhost:5173**.

---

## Using the demo

- The fleet loads and **health scores update live** every 3 seconds. Each card shows the
  health %, colored status, and a **confidence indicator** (`3/3 sensors`) that drops when
  a sensor momentarily reports null.
- **Simulate Failure** - use the global search box in the header (or the button inside any
  device's detail). The chosen device ramps toward a real failure regime over ~25s, turns
  **red**, and raises an **explainable alert** ("flagged by process temperature + torque").
- Click a device to open its detail: a **Recharts health/risk trend**, the ML factor
  breakdown, the **Impact priority**, the **Autonomous Agent** work order, and the
  device's **Maintenance Memory**.
- **Reset / resolve** a device from its detail panel - this clears the failure and writes a
  resolution back into Memory (closing the loop).

**Suggested demo devices:** `MRI-02` (heat-dissipation failure with two prior cooling
incidents in memory - the agent cites them), `VENT-01` (patient-critical ventilator →
Critical impact priority), `ECG-01` (temperature-only device driven Critical by the
safe-envelope limit alarm).

---

## The model & metrics

Trained on **AI4I 2020** (10,000 rows, ~3.4% failures). We report **failure-class** metrics,
not accuracy (accuracy is a trap on imbalanced data). Latest run:

| metric (failure class) | value |
|---|---|
| Precision | ~0.66 |
| Recall | ~0.78 |
| F1 | ~0.72 |
| PR-AUC | ~0.81 |
| ROC-AUC | ~0.97 |

Full numbers are saved to `model/artifacts/metrics.json` and surfaced in the header badge.

**Honest engineering notes**

- The five failure-subtype flags (TWF/HDF/PWF/OSF/RNF) are **dropped before training** - they
  leak the label. Class imbalance is handled with `scale_pos_weight`.
- Devices report **different sensor subsets**; missing sensors are `null`. AI4I has no missing
  values, so at inference we **impute the training median** for absent sensors (the recommended
  handling - never zero-fill) and only cite *reported* sensors as risk drivers.
- Temperature-only devices (ECG, spectrometer) genuinely can't reach the AI4I mechanical-failure
  regimes, so a rule-based **safe-envelope guard** raises hard limit alarms for gross
  out-of-range readings - exactly how real condition-monitoring pairs ML risk with limit alarms.
- Any "time to failure" would be a **projection** from the risk-trend slope, labelled estimated.
  A real RUL model (NASA C-MAPSS) is a separate, later track.

---

## Configuration (`backend/.env`)

| var | default | purpose |
|---|---|---|
| `PORT` | `4000` | backend port |
| `PREDICT_URL` | `http://localhost:8000` | prediction service |
| `MONGODB_URI` | `mongodb://localhost:27017` | Mongo (optional) |
| `TICK_SECONDS` | `3` | fleet update interval |
| `LLM_API_KEY` | *(empty)* | enables the LLM agent; **without it the agent uses a deterministic rule-based fallback** and the app still runs |
| `LLM_MODEL` | `claude-sonnet-5` | agent model when a key is set |

---

## Reset the demo to a clean state

```bash
# with mongosh installed:
mongosh labsentinel --eval "['readings','events','maintenance_history','work_orders'].forEach(c=>db[c].deleteMany({}))"
```
Then restart the backend - it re-seeds the maintenance history on startup.

---

## Repo layout

```
model/      train.py · serve.py · simulate.py · roster.py · artifacts/ · data/logs/ · config/
backend/    server.js · fleet.js · services/ (predictionClient, impactEngine, agent, memory, envelope, simulator) · models/
frontend/   Vite + React dashboard (components/: SystemOverview, FleetGrid, DeviceCard, AlertsPanel, DeviceDetail, …)
```
