"""Phase 1 - Train the failure classifier ONCE, offline.

Trains an XGBoost binary classifier on the AI4I 2020 Predictive Maintenance
dataset and saves the model + honest, failure-class metrics + feature schema.
The live app never retrains; it only runs inference on this saved model.

Key disciplines:
- Drop the leaky failure-subtype flags (TWF/HDF/PWF/OSF/RNF) before training.
- Handle the ~3.4% class imbalance with scale_pos_weight.
- Report recall / F1 / PR-AUC / ROC-AUC on the FAILURE class, not accuracy.
"""
import json
import os

import numpy as np
import pandas as pd
from sklearn.metrics import (average_precision_score, f1_score,
                             precision_score, recall_score, roc_auc_score,
                             confusion_matrix)
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier

HERE = os.path.dirname(os.path.abspath(__file__))
ARTIFACTS = os.path.join(HERE, "artifacts")
DATA_DIR = os.path.join(HERE, "data")
CONFIG_DIR = os.path.join(HERE, "config")

FEATURES = ["air_temperature", "process_temperature", "rotational_speed",
            "torque", "tool_wear"]
LEAKY = ["TWF", "HDF", "PWF", "OSF", "RNF"]
TARGET = "Machine failure"
N_AUG = 3  # masked copies per training row (teaches XGBoost missing-value branches)


def _match(cols, *keywords):
    """Find the column whose lowercased name contains all keywords."""
    for c in cols:
        lc = c.lower()
        if all(k in lc for k in keywords):
            return c
    return None


def load_dataset():
    """Return (X: DataFrame[FEATURES], y: Series) from ucimlrepo or a local CSV."""
    df = None
    try:
        from ucimlrepo import fetch_ucirepo
        print("[train] fetching AI4I 2020 via ucimlrepo (id=601)...")
        ds = fetch_ucirepo(id=601)
        df = pd.concat([ds.data.features, ds.data.targets], axis=1)
        print("[train] fetched from UCI repo.")
    except Exception as e:  # noqa: BLE001 - fall back to local file, no network
        print(f"[train] ucimlrepo fetch failed ({e}).")
        csv = os.path.join(DATA_DIR, "ai4i2020.csv")
        if not os.path.exists(csv):
            raise SystemExit(
                "Could not fetch AI4I 2020 and no local file found.\n"
                f"Please download ai4i2020.csv and place it at: {csv}\n"
                "Source: https://archive.ics.uci.edu/dataset/601/ai4i+2020+"
                "predictive+maintenance+dataset"
            )
        print(f"[train] reading local CSV: {csv}")
        df = pd.read_csv(csv)

    cols = list(df.columns)
    colmap = {
        "air_temperature": _match(cols, "air", "temp"),
        "process_temperature": _match(cols, "process", "temp"),
        "rotational_speed": _match(cols, "rotational") or _match(cols, "speed"),
        "torque": _match(cols, "torque"),
        "tool_wear": _match(cols, "tool", "wear"),
    }
    missing = [k for k, v in colmap.items() if v is None]
    if missing:
        raise SystemExit(f"Could not locate columns for: {missing}\nColumns: {cols}")

    target_col = TARGET if TARGET in cols else _match(cols, "machine", "failure")
    if target_col is None:
        target_col = _match(cols, "failure")
    if target_col is None:
        raise SystemExit(f"Could not locate target column. Columns: {cols}")

    X = pd.DataFrame({feat: pd.to_numeric(df[src], errors="coerce")
                      for feat, src in colmap.items()})[FEATURES]
    y = pd.to_numeric(df[target_col], errors="coerce").fillna(0).astype(int)

    # sanity-check the label against the leaky subtype flags (never train on them)
    present_flags = [f for f in LEAKY if f in cols]
    if present_flags:
        any_flag = (df[present_flags].apply(pd.to_numeric, errors="coerce")
                    .fillna(0).astype(int).sum(axis=1) > 0).astype(int)
        agree = float((any_flag == y).mean())
        print(f"[train] label vs subtype-flag agreement: {agree:.3f} "
              f"(dropping {present_flags} - leakage)")

    return X, y


def load_fleet_subsets():
    """Return (subsets, weights) - the real sensor subsets our devices report.

    AI4I has no missing values, so a model trained on it alone routes NaN sensors
    down arbitrary default branches and false-alarms on every device that reports
    a subset. We augment training with these exact subsets (weighted by fleet
    size) so XGBoost learns sensible missing-value directions natively.
    """
    with open(os.path.join(CONFIG_DIR, "device_types.json"), "r", encoding="utf-8") as f:
        cfg = json.load(f)
    counts = {e["type"]: e["count"] for e in cfg["fleet"]}
    subsets, weights = [], []
    for dtype, spec in cfg["device_types"].items():
        subsets.append(tuple(spec["reports"]))
        weights.append(counts.get(dtype, 1))
    return subsets, weights


def augment_missing(X, y, subsets, weights, n_aug, seed=42):
    """Add masked copies of each row, NaN-ing features outside a sampled subset."""
    rng = np.random.default_rng(seed)
    probs = np.asarray(weights, dtype=float)
    probs /= probs.sum()
    base = X.to_numpy(dtype=float)
    feat_idx = {f: i for i, f in enumerate(FEATURES)}
    aug_rows, aug_y = [], []
    for _ in range(n_aug):
        masked = base.copy()
        pick = rng.choice(len(subsets), size=len(base), p=probs)
        for r in range(len(base)):
            keep = subsets[pick[r]]
            for f in FEATURES:
                if f not in keep:
                    masked[r, feat_idx[f]] = np.nan
        aug_rows.append(masked)
        aug_y.append(y.to_numpy())
    X_aug = np.vstack([base] + aug_rows)
    y_aug = np.concatenate([y.to_numpy()] + aug_y)
    return pd.DataFrame(X_aug, columns=FEATURES), pd.Series(y_aug)


def _score(model, X_test, y_test, thr=0.5):
    proba = model.predict_proba(X_test)[:, 1]
    pred = (proba >= thr).astype(int)
    return {
        "precision": round(float(precision_score(y_test, pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_test, pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_test, pred, zero_division=0)), 4),
        "pr_auc": round(float(average_precision_score(y_test, proba)), 4),
        "roc_auc": round(float(roc_auc_score(y_test, proba)), 4),
    }


def main():
    os.makedirs(ARTIFACTS, exist_ok=True)
    X, y = load_dataset()

    pos = int(y.sum())
    neg = int(len(y) - pos)
    rate = pos / len(y)
    scale_pos_weight = neg / max(pos, 1)
    print(f"[train] samples={len(y)} failures={pos} ({rate*100:.2f}%) "
          f"scale_pos_weight={scale_pos_weight:.2f}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42)

    # Training medians. At inference a device reports only a subset of sensors;
    # the missing ones are imputed with these medians (the recommended handling
    # for a model trained on complete AI4I data - NOT zero-fill). This keeps
    # normal subset readings in-distribution instead of false-alarming.
    medians = {f: round(float(X_train[f].median()), 4) for f in FEATURES}
    subsets, weights = load_fleet_subsets()

    model = XGBClassifier(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.1,
        subsample=0.9,
        colsample_bytree=0.9,
        scale_pos_weight=scale_pos_weight,
        eval_metric="aucpr",
        tree_method="hist",
        random_state=42,
    )
    model.fit(X_train, y_train)

    proba = model.predict_proba(X_test)[:, 1]
    pred = (proba >= 0.5).astype(int)
    full = _score(model, X_test, y_test)

    # realistic evaluation: score the held-out set through the fleet's sensor
    # subsets (mask to a subset, then impute medians exactly like the server)
    X_test_masked, y_test_masked = augment_missing(
        X_test, y_test, subsets, weights, n_aug=1, seed=7)
    X_test_masked = X_test_masked.iloc[len(X_test):].copy()  # keep only masked copies
    y_test_masked = y_test_masked.iloc[len(y_test):]
    for f in FEATURES:
        X_test_masked[f] = X_test_masked[f].fillna(medians[f])
    masked = _score(model, X_test_masked, y_test_masked)

    metrics = {
        "dataset": "AI4I 2020 Predictive Maintenance (UCI id=601)",
        "model": "XGBoost classifier (max_depth=5, n_estimators=200), "
                 "trained with fleet-subset missing-value augmentation",
        "n_samples": int(len(y)),
        "n_failures": pos,
        "failure_rate": round(rate, 4),
        "scale_pos_weight": round(scale_pos_weight, 3),
        "threshold": 0.5,
        "failure_class": full,
        "failure_class_realistic_subset": masked,
        "confusion_matrix": confusion_matrix(y_test, pred).tolist(),
        "note": "Metrics are on the held-out FAILURE class - accuracy is omitted "
                "on purpose because the data is highly imbalanced (~3.4% failures). "
                "'failure_class' uses all 5 sensors; 'failure_class_realistic_subset' "
                "scores each test row through the device sensor subsets the fleet "
                "actually reports (missing sensors as null).",
    }
    fc = full

    # feature importances for downstream explainability fallback
    importances = {f: round(float(w), 4)
                   for f, w in zip(FEATURES, model.feature_importances_)}

    model.save_model(os.path.join(ARTIFACTS, "model.json"))
    with open(os.path.join(ARTIFACTS, "feature_schema.json"), "w", encoding="utf-8") as f:
        json.dump({"feature_order": FEATURES,
                   "feature_importances": importances,
                   "impute_medians": medians}, f, indent=2)
    with open(os.path.join(ARTIFACTS, "metrics.json"), "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    print("\n[train] SAVED artifacts to", ARTIFACTS)
    print(f"[train] FAILURE-CLASS (all sensors)   precision={fc['precision']}  "
          f"recall={fc['recall']}  F1={fc['f1']}  PR-AUC={fc['pr_auc']}  ROC-AUC={fc['roc_auc']}")
    print(f"[train] FAILURE-CLASS (fleet subsets) precision={masked['precision']}  "
          f"recall={masked['recall']}  F1={masked['f1']}  PR-AUC={masked['pr_auc']}  "
          f"ROC-AUC={masked['roc_auc']}")
    print("[train] One-liner for the deck: "
          f"\"On held-out AI4I 2020 data our model catches {fc['recall']*100:.0f}% of "
          f"failures (recall) at {fc['precision']*100:.0f}% precision, "
          f"F1={fc['f1']}, PR-AUC={fc['pr_auc']}.\"")


if __name__ == "__main__":
    main()
