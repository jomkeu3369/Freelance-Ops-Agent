"""Interactive comparison of SGD online learning and XGBoost warm-start updates.

Run:
    pip install streamlit numpy pandas scikit-learn xgboost plotly
    streamlit run streamlit_xgb_sgd_online_demo.py
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import plotly.express as px
import streamlit as st
import xgboost as xgb
from sklearn.linear_model import SGDRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.preprocessing import StandardScaler


FEATURE_NAMES = ["token_count", "tool_count", "context_size", "queue_depth"]
DEFAULT_MODEL_PATH = "xgb_online_model.json"


def make_regression_batch(
    n_samples: int,
    rng: np.random.Generator,
    drift: float = 0.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Generate a nonlinear runtime-like regression batch with optional drift."""
    token_count = rng.uniform(100, 12_000, n_samples)
    tool_count = rng.integers(0, 9, n_samples).astype(float)
    context_size = rng.uniform(500, 32_000, n_samples)
    queue_depth = rng.integers(0, 21, n_samples).astype(float)
    X = np.column_stack([token_count, tool_count, context_size, queue_depth])

    y = (
        0.00045 * token_count
        + 0.38 * tool_count
        + 0.000055 * context_size
        + 0.11 * queue_depth
        + 1.8 * (token_count > 8_000)
        + 0.75 * np.sin(tool_count)
        + 0.000012 * context_size * queue_depth
    )
    # Drift changes both the intercept and the token sensitivity.
    y += drift * (1.5 + 0.00022 * token_count)
    y += rng.normal(0.0, 0.65, n_samples)
    return X.astype(np.float64), y.astype(np.float64)


def xgb_params(seed: int) -> dict[str, Any]:
    return {
        "objective": "reg:squarederror",
        "eval_metric": "mae",
        "eta": 0.08,
        "max_depth": 4,
        "subsample": 0.9,
        "colsample_bytree": 0.9,
        "seed": seed,
        "nthread": 2,
    }


def booster_rounds(booster: xgb.Booster) -> int:
    """Return the number of boosted rounds across supported XGBoost versions."""
    try:
        return int(booster.num_boosted_rounds())
    except AttributeError:
        config = json.loads(booster.save_config())
        return int(
            config["learner"]["gradient_booster"]["gbtree_model_param"]["num_trees"]
        )


def evaluate_models() -> tuple[float, float, np.ndarray, np.ndarray]:
    state = st.session_state
    sgd_pred = state.sgd_model.predict(state.scaler.transform(state.X_test))
    test_matrix = xgb.DMatrix(state.X_test, feature_names=FEATURE_NAMES)
    xgb_pred = state.xgb_model.predict(test_matrix)
    return (
        float(mean_absolute_error(state.y_test, sgd_pred)),
        float(mean_absolute_error(state.y_test, xgb_pred)),
        sgd_pred,
        xgb_pred,
    )


def record_metrics(label: str) -> None:
    sgd_mae, xgb_mae, _, _ = evaluate_models()
    st.session_state.metrics.append(
        {
            "update": len(st.session_state.metrics),
            "label": label,
            "SGDRegressor": sgd_mae,
            "XGBoost": xgb_mae,
            "xgb_rounds": booster_rounds(st.session_state.xgb_model),
        }
    )


def initialize(seed: int, initial_samples: int, initial_rounds: int) -> None:
    rng = np.random.default_rng(seed)
    X_train, y_train = make_regression_batch(initial_samples, rng)
    X_test, y_test = make_regression_batch(600, rng, drift=0.35)

    scaler = StandardScaler().fit(X_train)
    sgd_model = SGDRegressor(
        loss="huber",
        penalty="l2",
        alpha=0.0001,
        learning_rate="adaptive",
        eta0=0.01,
        max_iter=2_000,
        tol=1e-4,
        random_state=seed,
    )
    sgd_model.fit(scaler.transform(X_train), y_train)

    train_matrix = xgb.DMatrix(X_train, label=y_train, feature_names=FEATURE_NAMES)
    xgb_model = xgb.train(xgb_params(seed), train_matrix, num_boost_round=initial_rounds)

    st.session_state.seed = seed
    st.session_state.rng = rng
    st.session_state.scaler = scaler
    st.session_state.sgd_model = sgd_model
    st.session_state.xgb_model = xgb_model
    st.session_state.X_test = X_test
    st.session_state.y_test = y_test
    st.session_state.total_online_samples = 0
    st.session_state.metrics = []
    record_metrics("Initial training")


def add_online_batch(batch_size: int, drift: float, extra_rounds: int) -> None:
    state = st.session_state
    X_new, y_new = make_regression_batch(batch_size, state.rng, drift=drift)

    # Keep the scaler fixed: changing its coordinate system would invalidate the
    # coefficients already learned by SGDRegressor.
    state.sgd_model.partial_fit(state.scaler.transform(X_new), y_new)

    update_matrix = xgb.DMatrix(X_new, label=y_new, feature_names=FEATURE_NAMES)
    state.xgb_model = xgb.train(
        xgb_params(state.seed),
        update_matrix,
        num_boost_round=extra_rounds,
        xgb_model=state.xgb_model,
    )
    state.total_online_samples += batch_size
    record_metrics(f"Batch {len(state.metrics)} (+{batch_size})")


def render_scatter(actual: np.ndarray, predicted: np.ndarray, title: str) -> None:
    frame = pd.DataFrame({"Actual": actual, "Predicted": predicted})
    low = float(min(frame.min()))
    high = float(max(frame.max()))
    fig = px.scatter(frame, x="Actual", y="Predicted", opacity=0.6, title=title)
    fig.add_shape(type="line", x0=low, y0=low, x1=high, y1=high, line={"dash": "dash"})
    fig.update_layout(height=390)
    st.plotly_chart(fig, use_container_width=True)


st.set_page_config(page_title="SGD vs XGBoost Online Learning", layout="wide")
st.title("SGDRegressor online learning vs XGBoost warm-start updates")
st.caption(
    "SGD learns each incoming batch with partial_fit; XGBoost appends trees with "
    "xgb.train(..., xgb_model=existing_model)."
)

with st.sidebar:
    st.header("Initial training")
    seed = st.number_input("Random seed", min_value=0, value=42, step=1)
    initial_samples = st.slider("Initial samples", 200, 5_000, 1_000, 100)
    initial_rounds = st.slider("Initial boosting rounds", 10, 300, 60, 10)
    if st.button("Initialize / reset models", type="primary", use_container_width=True):
        initialize(int(seed), initial_samples, initial_rounds)

    st.header("Online update")
    batch_size = st.slider("New batch size", 10, 1_000, 100, 10)
    drift = st.slider("Data drift strength", 0.0, 2.0, 0.5, 0.1)
    extra_rounds = st.slider("Extra XGBoost rounds", 1, 100, 10, 1)
    update_clicked = st.button("Generate batch and update", use_container_width=True)

if "xgb_model" not in st.session_state:
    initialize(int(seed), initial_samples, initial_rounds)

if update_clicked:
    add_online_batch(batch_size, drift, extra_rounds)
    st.toast(f"Updated both models with {batch_size} new samples")

sgd_mae, xgb_mae, sgd_pred, xgb_pred = evaluate_models()
metric_cols = st.columns(4)
metric_cols[0].metric("SGD test MAE", f"{sgd_mae:.3f}")
metric_cols[1].metric("XGBoost test MAE", f"{xgb_mae:.3f}")
metric_cols[2].metric("XGBoost boosted rounds / trees", booster_rounds(st.session_state.xgb_model))
metric_cols[3].metric("Online samples seen", st.session_state.total_online_samples)

st.subheader("MAE over updates")
history = pd.DataFrame(st.session_state.metrics)
history_long = history.melt(
    id_vars=["update", "label", "xgb_rounds"],
    value_vars=["SGDRegressor", "XGBoost"],
    var_name="Model",
    value_name="MAE",
)
mae_fig = px.line(
    history_long,
    x="update",
    y="MAE",
    color="Model",
    markers=True,
    hover_data=["label", "xgb_rounds"],
)
mae_fig.update_layout(height=390, xaxis_title="Update number")
st.plotly_chart(mae_fig, use_container_width=True)

left, right = st.columns(2)
with left:
    render_scatter(st.session_state.y_test, sgd_pred, "SGD: prediction vs actual")
with right:
    render_scatter(st.session_state.y_test, xgb_pred, "XGBoost: prediction vs actual")

st.subheader("XGBoost feature importance")
importance_type = st.selectbox("Importance type", ["gain", "weight", "cover"])
importance = st.session_state.xgb_model.get_score(importance_type=importance_type)
importance_frame = pd.DataFrame(
    {"Feature": FEATURE_NAMES, "Importance": [importance.get(name, 0.0) for name in FEATURE_NAMES]}
).sort_values("Importance", ascending=True)
importance_fig = px.bar(
    importance_frame,
    x="Importance",
    y="Feature",
    orientation="h",
    title=f"Feature importance ({importance_type})",
)
importance_fig.update_layout(height=350)
st.plotly_chart(importance_fig, use_container_width=True)

st.subheader("Save / load XGBoost model")
path_col, action_col = st.columns([3, 2])
with path_col:
    model_path = st.text_input("Model path", DEFAULT_MODEL_PATH)
with action_col:
    save_col, load_col = st.columns(2)
    if save_col.button("Save model", use_container_width=True):
        try:
            st.session_state.xgb_model.save_model(model_path)
            st.success(f"Saved to {Path(model_path).resolve()}")
        except Exception as exc:
            st.error(f"Could not save model: {exc}")
    if load_col.button("Load model", use_container_width=True):
        try:
            loaded = xgb.Booster()
            loaded.load_model(model_path)
            st.session_state.xgb_model = loaded
            record_metrics(f"Loaded {Path(model_path).name}")
            st.success(f"Loaded {Path(model_path).resolve()}")
            st.rerun()
        except Exception as exc:
            st.error(f"Could not load model: {exc}")

model_bytes = st.session_state.xgb_model.save_raw(raw_format="json")
st.download_button(
    "Download current XGBoost model (.json)",
    data=bytes(model_bytes),
    file_name="xgb_online_model.json",
    mime="application/json",
)

with st.expander("Run instructions and dependencies"):
    st.markdown(
        """
1. Create and activate a Python 3.10+ virtual environment.
2. Install dependencies:

```bash
pip install streamlit numpy pandas scikit-learn xgboost plotly
```

3. Start the app:

```bash
streamlit run streamlit_xgb_sgd_online_demo.py
```

The test set is fixed after initialization, so the MAE history remains comparable.
XGBoost's warm start appends new trees; it does not update the existing trees in place.
For long-running production systems, periodically retrain XGBoost on a representative
historical window to control model growth and forgetting behavior.
        """
    )

