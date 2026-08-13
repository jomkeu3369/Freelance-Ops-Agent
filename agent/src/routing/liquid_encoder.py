"""Optional LiquidAI encoder adapter for local routing diagnostics."""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .hybrid import ROUTE_ORDER, RouteLabel


class LiquidEncoderRouteScorer:
    """Score every route with the pinned LiquidAI model and trained routing head."""

    def __init__(
        self,
        *,
        model_id: str,
        revision: str,
        head_path: Path,
        route_descriptions: Mapping[RouteLabel, str],
        device: str = "auto",
    ) -> None:
        try:
            import torch
            from safetensors.torch import load_file
            from transformers import AutoModel, AutoTokenizer
        except ImportError as error:
            raise RuntimeError(
                "local router dependencies are missing; install the local-router extra"
            ) from error

        if device not in {"auto", "cpu", "cuda"}:
            raise ValueError("router device must be one of: auto, cpu, cuda")
        if device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested but is not available")
        selected_device = "cuda" if device == "cuda" or (device == "auto" and torch.cuda.is_available()) else "cpu"

        self._torch = torch
        self._device = torch.device(selected_device)
        self._tokenizer = AutoTokenizer.from_pretrained(
            model_id,
            revision=revision,
            trust_remote_code=True,
        )
        model = AutoModel.from_pretrained(
            model_id,
            revision=revision,
            trust_remote_code=True,
        )
        missing, unexpected = model.load_state_dict(load_file(str(head_path)), strict=False)
        invalid_missing = [name for name in missing if not name.startswith("lfm2.")]
        if invalid_missing or unexpected:
            raise RuntimeError(
                f"invalid routing head: missing={invalid_missing}, unexpected={unexpected}"
            )
        self._model = model.eval().to(self._device)
        self._route_lanes = [f"{route.value}: {route_descriptions[route]}" for route in ROUTE_ORDER]
        self._inference_lock = threading.Lock()
        self._model_id = f"{model_id}@{revision}"

    @property
    def model_id(self) -> str:
        return self._model_id

    async def score_routes(self, text: str) -> Mapping[RouteLabel, float]:
        return await asyncio.to_thread(self._score_routes_sync, text)

    def _score_routes_sync(self, text: str) -> dict[RouteLabel, float]:
        with self._inference_lock, self._torch.inference_mode():
            raw_scores: list[dict[str, Any]] = self._model.route(
                text,
                self._route_lanes,
                tokenizer=self._tokenizer,
            )

        scores: dict[RouteLabel, float] = {}
        for item in raw_scores:
            route_name = str(item["route"]).split(":", 1)[0]
            scores[RouteLabel(route_name)] = float(item["score"])
        if set(scores) != set(ROUTE_ORDER):
            raise RuntimeError("LiquidAI encoder did not score every configured route")
        return scores
