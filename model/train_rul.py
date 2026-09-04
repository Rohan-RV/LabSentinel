"""Train the Remaining-Useful-Life (RUL) regressor ONCE, offline.

Trains an XGBoost regressor on the NASA C-MAPSS FD001 turbofan run-to-failure
dataset and saves the model plus honest RUL metrics (RMSE, NASA score, MAE, R2)
and a schema. The live app never retrains; it only runs inference / projection.

This is a genuine, benchmarked RUL model on real run-to-failure data. It is a
separate track from the fleet failure classifier: the lab/hospital devices do
not report turbofan sensors, so the live dashboard shows an estimated
time-to-failure projected from each device's own risk trend, while this model
proves the RUL methodology on the standard NASA benchmark.

Run:  python train_rul.py   (auto-downloads FD001 into data/cmapss/ if missing)

Disciplines:
- Piecewise-linear RUL target capped at 125 cycles (standard C-MAPSS practice).
- Drop constant / non-informative columns automatically (variance filter).
- Light per-unit rolling-mean smoothing to cut sensor noise.
- Report RMSE, NASA asymmetric score, MAE and R2 on the held-out test units,
  scoring the last observed cycle of each engine against the provided true RUL.
"""
import json
import os
import urllib.request

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from xgboost import XGBRegressor

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data", "cmapss")
ART = os.path.join(HERE, "artifacts")

DATA_BASE = ("https://raw.githubusercontent.com/mapr-demos/predictive-maintenance/"
             "master/notebooks/jupyter/Dataset/CMAPSSData/")
DATA_FILES = ["train_FD001.txt", "test_FD001.txt", "RUL_FD001.txt"]

RUL_CAP = 125          # piecewise-linear RUL clip (standard for C-MAPSS)
SMOOTH_WINDOW = 5      # per-unit rolling mean to denoise sensors
VAR_EPS = 1e-6         # drop columns with (near) zero variance

INDEX_COLS = ["unit", "cycle"]
OP_COLS = ["op1", "op2", "op3"]
SENSOR_COLS = [f"s{i}" for i in range(1, 22)]
ALL_COLS = INDEX_COLS + OP_COLS + SENSOR_COLS


def ensure_data():
    os.makedirs(DATA, exist_ok=True)
    for fn in DATA_FILES:
        p = os.path.join(DATA, fn)
        if not os.path.exists(p):
            print(f"[rul] downloading {fn} ...")
            urllib.request.urlretrieve(DATA_BASE + fn, p)


def load(name):
    df = pd.read_csv(os.path.join(DATA, name), sep=r"\s+", header=None)
    df = df.iloc[:, : len(ALL_COLS)]
    df.columns = ALL_COLS
    return df


def add_rul(df):
    life = df.groupby("unit")["cycle"].transform("max")
    df = df.copy()
    df["RUL"] = (life - df["cycle"]).clip(upper=RUL_CAP)
    return df


def smooth(df, feats):
    df = df.copy()
    df[feats] = (
        df.groupby("unit")[feats]
        .transform(lambda s: s.rolling(SMOOTH_WINDOW, min_periods=1).mean())
    )
    return df


def nasa_score(y_true, y_pred):
    """C-MAPSS asymmetric score: late predictions (d>0) punished harder."""
    d = np.asarray(y_pred, dtype=float) - np.asarray(y_true, dtype=float)
    s = np.where(d < 0, np.exp(-d / 13.0) - 1.0, np.exp(d / 10.0) - 1.0)
    return float(np.sum(s))


def main():
    os.makedirs(ART, exist_ok=True)
    ensure_data()
    train = add_rul(load("train_FD001.txt"))
    test = load("test_FD001.txt")
    true_rul = pd.read_csv(os.path.join(DATA, "RUL_FD001.txt"), header=None)[
        0].to_numpy()

    candidate = OP_COLS + SENSOR_COLS
    variances = train[candidate].var()
    feats = [c for c in candidate if variances[c] > VAR_EPS]
    dropped = [c for c in candidate if c not in feats]

    train = smooth(train, feats)
    test = smooth(test, feats)

    X_train, y_train = train[feats], train["RUL"]

    model = XGBRegressor(
        n_estimators=300,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.8,
        reg_lambda=1.0,
        tree_method="hist",
        random_state=42,
        objective="reg:squarederror",
    )
    model.fit(X_train, y_train)

    last = test.groupby("unit").tail(1).reset_index(drop=True)
    X_test = last[feats]
    y_pred = np.clip(model.predict(X_test), 0, RUL_CAP)
    y_true = true_rul

    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    mae = float(mean_absolute_error(y_true, y_pred))
    r2 = float(r2_score(y_true, y_pred))
    score = nasa_score(y_true, y_pred)

    rng = np.random.default_rng(42)
    idx = sorted(rng.choice(len(y_true), size=min(
        8, len(y_true)), replace=False).tolist())
    samples = [
        {"unit": int(last.loc[i, "unit"]),
         "predicted": round(float(y_pred[i]), 1),
         "actual": int(y_true[i])}
        for i in idx
    ]

    metrics = {
        "dataset": "NASA C-MAPSS FD001 (turbofan run-to-failure, 100 train / 100 test engines)",
        "model": "XGBoost regressor (max_depth=5, n_estimators=300), piecewise-linear RUL cap 125",
        "task": "Remaining Useful Life regression (cycles)",
        "n_train_units": int(train["unit"].nunique()),
        "n_test_units": int(len(y_true)),
        "rul_cap": RUL_CAP,
        "rmse": round(rmse, 2),
        "mae": round(mae, 2),
        "r2": round(r2, 3),
        "nasa_score": round(score, 1),
        "samples": samples,
        "note": "RMSE and the NASA asymmetric score are computed on the last "
                "observed cycle of each held-out test engine against the provided "
                "true RUL. This is a real RUL benchmark; the live fleet shows an "
                "estimated time-to-failure projected from each device's risk trend.",
    }

    importances = {f: round(float(w), 4)
                   for f, w in zip(feats, model.feature_importances_)}

    model.save_model(os.path.join(ART, "rul_model.json"))
    with open(os.path.join(ART, "rul_feature_schema.json"), "w", encoding="utf-8") as f:
        json.dump({"feature_order": feats,
                   "dropped_constant": dropped,
                   "rul_cap": RUL_CAP,
                   "smooth_window": SMOOTH_WINDOW,
                   "feature_importances": importances}, f, indent=2)
    with open(os.path.join(ART, "rul_metrics.json"), "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    print(f"[rul] features used ({len(feats)}): {feats}")
    print(f"[rul] dropped constant: {dropped}")
    print(
        f"[rul] RMSE={rmse:.2f} cycles  MAE={mae:.2f}  R2={r2:.3f}  NASA-score={score:.1f}")
    print(f"[rul] saved artifacts to {ART}")


if __name__ == "__main__":
    main()
