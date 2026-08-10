from __future__ import annotations

import os
import random
import time
from dataclasses import dataclass
from typing import Any

import numpy as np

from .dataset import RequirementExample
from .metrics import classification_metrics, latency_metrics


@dataclass
class ClassifierRun:
    name: str
    model_id: str
    metrics: dict[str, Any]
    predictions: list[dict[str, Any]]


def _seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    import torch

    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def train_and_benchmark(
    model_config: dict[str, str],
    splits: dict[str, list[RequirementExample]],
    training: dict[str, Any],
    label_names: dict[str, str],
) -> ClassifierRun:
    import torch
    from torch.optim import AdamW
    from torch.utils.data import DataLoader, Dataset
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    seed = int(training["seed"])
    _seed_everything(seed)
    requested_device = str(training.get("device", "auto"))
    if requested_device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError(
            "CUDA was required by config but is unavailable. Install a CUDA-enabled Torch wheel."
        )
    device = torch.device(
        "cuda" if requested_device == "cuda" or (requested_device == "auto" and torch.cuda.is_available()) else "cpu"
    )
    if device.type == "cuda":
        torch.set_float32_matmul_precision("high")
        torch.cuda.reset_peak_memory_stats()
    precision = str(training.get("mixed_precision", "none"))
    use_bf16 = device.type == "cuda" and precision == "bf16" and torch.cuda.is_bf16_supported()
    tokenizer = AutoTokenizer.from_pretrained(model_config["model_id"])
    model = AutoModelForSequenceClassification.from_pretrained(
        model_config["model_id"], num_labels=len(label_names)
    ).to(device)
    print(f"[{model_config['name']}] loaded on {device}; training {len(splits['train'])} rows")

    class EncodedDataset(Dataset):
        def __init__(self, rows: list[RequirementExample]) -> None:
            self.rows = rows

        def __len__(self) -> int:
            return len(self.rows)

        def __getitem__(self, index: int) -> dict[str, Any]:
            row = self.rows[index]
            encoded = tokenizer(
                row.text,
                truncation=True,
                max_length=int(training["max_length"]),
                padding="max_length",
                return_tensors="pt",
            )
            return {
                **{key: value.squeeze(0) for key, value in encoded.items()},
                "labels": torch.tensor(row.label, dtype=torch.long),
            }

    generator = torch.Generator().manual_seed(seed)
    loader = DataLoader(
        EncodedDataset(splits["train"]),
        batch_size=int(training["batch_size"]),
        shuffle=True,
        generator=generator,
        pin_memory=device.type == "cuda",
    )
    optimizer = AdamW(model.parameters(), lr=float(training["learning_rate"]))
    train_started = time.perf_counter()
    model.train()
    for epoch in range(int(training["epochs"])):
        for batch in loader:
            optimizer.zero_grad(set_to_none=True)
            batch = {
                key: value.to(device, non_blocking=device.type == "cuda")
                for key, value in batch.items()
            }
            with torch.autocast(device_type=device.type, dtype=torch.bfloat16, enabled=use_bf16):
                loss = model(**batch).loss
            loss.backward()
            optimizer.step()
        print(f"[{model_config['name']}] epoch {epoch + 1}/{training['epochs']} complete")
    if device.type == "cuda":
        torch.cuda.synchronize()
    training_seconds = time.perf_counter() - train_started

    def predict_one(text: str) -> tuple[int, float]:
        inputs = tokenizer(
            text,
            truncation=True,
            max_length=int(training["max_length"]),
            return_tensors="pt",
        )
        inputs = {
            key: value.to(device, non_blocking=device.type == "cuda")
            for key, value in inputs.items()
        }
        with torch.inference_mode(), torch.autocast(
            device_type=device.type, dtype=torch.bfloat16, enabled=use_bf16
        ):
            probabilities = torch.softmax(model(**inputs).logits.float(), dim=-1)[0]
        predicted = int(torch.argmax(probabilities).item())
        return predicted, float(probabilities[predicted].item())

    model.eval()
    warmups = min(int(training["warmup_samples"]), len(splits["validation"]))
    for row in splits["validation"][:warmups]:
        predict_one(row.text)
    if device.type == "cuda":
        torch.cuda.synchronize()

    predictions: list[dict[str, Any]] = []
    latencies_ms: list[float] = []
    inference_started = time.perf_counter()
    for row in splits["test"]:
        started = time.perf_counter()
        predicted, confidence = predict_one(row.text)
        if device.type == "cuda":
            torch.cuda.synchronize()
        latency_ms = (time.perf_counter() - started) * 1_000
        latencies_ms.append(latency_ms)
        predictions.append(
            {
                "id": row.id,
                "text": row.text,
                "reference_label": label_names[str(row.label)],
                "predicted_label": label_names[str(predicted)],
                "reference_label_id": row.label,
                "predicted_label_id": predicted,
                "confidence": confidence,
                "latency_ms": latency_ms,
            }
        )
    inference_seconds = time.perf_counter() - inference_started
    print(f"[{model_config['name']}] evaluated {len(predictions)} test rows")
    model_bytes = sum(parameter.numel() * parameter.element_size() for parameter in model.parameters())
    hourly_rate = float(os.getenv("BENCHMARK_COMPUTE_USD_PER_HOUR", "0"))
    metrics = {
        **classification_metrics(
            [row.label for row in splits["test"]],
            [prediction["predicted_label_id"] for prediction in predictions],
        ),
        **latency_metrics(latencies_ms, inference_seconds),
        "training_seconds": training_seconds,
        "estimated_compute_cost_usd": training_seconds / 3_600 * hourly_rate,
        "parameter_memory_mb": model_bytes / 1024**2,
        "device": str(device),
        "device_name": torch.cuda.get_device_name(0) if device.type == "cuda" else "CPU",
        "mixed_precision": "bf16" if use_bf16 else "none",
        "peak_cuda_memory_mb": (
            torch.cuda.max_memory_allocated() / 1024**2 if device.type == "cuda" else 0.0
        ),
        "test_samples": len(predictions),
    }
    return ClassifierRun(model_config["name"], model_config["model_id"], metrics, predictions)
