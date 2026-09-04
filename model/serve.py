"""Phase 2 - Prediction service (FastAPI). INFERENCE ONLY. Never trains.

Loads the saved XGBoost model once at startup and scores batches of readings in
microseconds each. Missing sensors arrive as null and are passed to XGBoost as
NaN (handled natively - never zero-filled).

Endpoints:
  POST /predict  -> per-reading failure_probability, health_score, top_factors
  GET  /metrics  -> the saved training metrics.json
  GET  /health   -> liveness probe
"""
import json
import os
from typing import List, Optional

import numpy as np
import xgboost as xgb
from fastapi import FastAPI
from pydantic import BaseModel
from xgboost import XGBClassifier

HERE = os.path.dirname(os.path.abspath(__file__))
ARTIFACTS = os.path.join(HERE, "artifacts")

with open(os.path.join(ARTIFACTS, "feature_schema.json"), "r", encoding="utf-8") as f:
    SCHEMA = json.load(f)
FEATURES: List[str] = SCHEMA["feature_order"]
# Missing sensors are imputed with the training median (recommended handling for
# a model trained on complete AI4I data - never zero-filled). top_factors below
# still only cites sensors the device actually reported.
MEDIANS = SCHEMA.get("impute_medians", {f: 0.0 for f in FEATURES})

_model = XGBClassifier()
_model.load_model(os.path.join(ARTIFACTS, "model.json"))
_booster = _model.get_booster()

try:
    with open(os.path.join(ARTIFACTS, "metrics.json"), "r", encoding="utf-8") as f:
        METRICS = json.load(f)
except FileNotFoundError:
    METRICS = {"note": "metrics.json not found - run train.py"}

app = FastAPI(title="LabSentinel Prediction Service", version="1.0.0")


class Reading(BaseModel):
    air_temperature: Optional[float] = None
    process_temperature: Optional[float] = None
    rotational_speed: Optional[float] = None
    torque: Optional[float] = None
    tool_wear: Optional[float] = None


class PredictRequest(BaseModel):
    readings: List[Reading]


class Factor(BaseModel):
    feature: str
    contribution: float
    value: Optional[float]
    direction: str  # "raises_risk" | "lowers_risk"


class Prediction(BaseModel):
    failure_probability: float
    health_score: int
    top_factors: List[Factor]


class PredictResponse(BaseModel):
    predictions: List[Prediction]


def _matrix(readings: List[Reading]):
    """Return (imputed feature matrix, reported-mask). Missing sensors are filled
    with the training median for scoring, but flagged so they aren't cited as
    drivers."""
    rows, reported = [], []
    for r in readings:
        d = r.model_dump()
        row, rep = [], []
        for f in FEATURES:
            v = d.get(f)
            rep.append(v is not None)
            row.append(float(v) if v is not None else MEDIANS[f])
        rows.append(row)
        reported.append(rep)
    return np.asarray(rows, dtype=float), np.asarray(reported, dtype=bool)


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest) -> PredictResponse:
    if not req.readings:
        return PredictResponse(predictions=[])

    X, reported = _matrix(req.readings)
    dmat = xgb.DMatrix(X, feature_names=FEATURES)

    proba = _booster.predict(dmat)                       # failure probability
    contribs = _booster.predict(dmat, pred_contribs=True)  # SHAP-style, log-odds

    out: List[Prediction] = []
    for i, p in enumerate(proba):
        prob = float(p)
        row_contribs = contribs[i][:len(FEATURES)]  # drop bias term
        vals = X[i]
        factors = []
        for j, feat in enumerate(FEATURES):
            if not reported[i][j]:
                continue  # sensor not reported (imputed) - cannot be a driver
            factors.append((feat, float(row_contribs[j]), round(float(vals[j]), 2)))
        # top 3 by absolute impact on THIS prediction
        factors.sort(key=lambda t: abs(t[1]), reverse=True)
        top = [Factor(feature=f, contribution=round(c, 4), value=v,
                      direction="raises_risk" if c >= 0 else "lowers_risk")
               for f, c, v in factors[:3]]
        out.append(Prediction(
            failure_probability=round(prob, 4),
            health_score=int(round((1 - prob) * 100)),
            top_factors=top,
        ))
    return PredictResponse(predictions=out)


@app.get("/metrics")
def metrics():
    return METRICS


@app.get("/health")
def health():
    return {"status": "ok", "features": FEATURES, "model": "xgboost"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PREDICT_PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
