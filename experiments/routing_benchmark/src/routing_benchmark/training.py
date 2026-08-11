from __future__ import annotations

import hashlib
import json
import platform
import random
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import torch
import torch.nn.functional as F
from safetensors.torch import save_file

from .config import RoutingConfig
from .metrics import routing_metrics

HEAD_KEYS = (
    "tok_proj.weight",
    "tok_proj.bias",
    "rule_proj.weight",
    "rule_proj.bias",
    "score_bias",
    "logit_scale",
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def _stratified_subset(
    rows: list[dict[str, Any]], labels: list[str], size: int, seed: int
) -> list[dict[str, Any]]:
    if size % len(labels):
        raise ValueError("Learning curve sizes must be divisible by the route count")
    rng = random.Random(seed)
    per_label = size // len(labels)
    result: list[dict[str, Any]] = []
    for label in labels:
        candidates = [row for row in rows if row["expected_route"] == label]
        if len(candidates) < per_label:
            raise ValueError(f"Not enough {label} rows for size {size}")
        result.extend(rng.sample(candidates, per_label))
    rng.shuffle(result)
    return result


def _encode_batch(
    tokenizer: Any,
    model: Any,
    prompts: list[str],
    route_lanes: list[str],
    device: torch.device,
    max_length: int,
) -> tuple[dict[str, torch.Tensor], torch.Tensor, torch.Tensor]:
    prefix = model._prefix(route_lanes)
    texts = [prefix + prompt for prompt in prompts]
    encoded = tokenizer(
        texts,
        padding=True,
        truncation=True,
        max_length=max_length,
        return_offsets_mapping=True,
        return_tensors="pt",
    )
    offsets = encoded.pop("offset_mapping")
    batch_size, sequence_length = encoded["input_ids"].shape
    dtype = next(model.parameters()).dtype
    text_pool = torch.zeros(batch_size, 1, sequence_length, device=device, dtype=dtype)
    category_pool = torch.zeros(
        batch_size, len(route_lanes), sequence_length, device=device, dtype=dtype
    )
    category_ranges = model._category_ranges(route_lanes)
    text_start = len(prefix)

    for batch_index, sample_offsets in enumerate(offsets.tolist()):
        text_indices = [
            index
            for index, (start, end) in enumerate(sample_offsets)
            if end > text_start and start != end
        ]
        if not text_indices:
            raise ValueError("A training prompt was fully truncated")
        text_pool[batch_index, 0, text_indices] = 1 / len(text_indices)
        for route_index, (start, end) in enumerate(category_ranges):
            indices = [
                index
                for index, (token_start, token_end) in enumerate(sample_offsets)
                if token_start < end and token_end > start and token_start != token_end
            ]
            if not indices:
                raise ValueError("A route description was fully truncated")
            category_pool[batch_index, route_index, indices] = 1 / len(indices)

    tensors = {name: value.to(device) for name, value in encoded.items()}
    return tensors, text_pool, category_pool


@torch.inference_mode()
def _evaluate(
    model: Any,
    tokenizer: Any,
    rows: list[dict[str, Any]],
    labels: list[str],
    route_lanes: list[str],
    device: torch.device,
    batch_size: int,
    max_length: int,
) -> dict[str, Any]:
    model.eval()
    predictions: list[str] = []
    truth: list[str] = []
    for start in range(0, len(rows), batch_size):
        batch = rows[start : start + batch_size]
        encoded, text_pool, category_pool = _encode_batch(
            tokenizer,
            model,
            [row["prompt"] for row in batch],
            route_lanes,
            device,
            max_length,
        )
        with torch.autocast(device_type=device.type, dtype=torch.bfloat16):
            logits = model(**encoded, text_pool=text_pool, category_pool=category_pool)["logits"]
        predictions.extend(labels[index] for index in logits.argmax(dim=-1).cpu().tolist())
        truth.extend(row["expected_route"] for row in batch)
    return routing_metrics(truth, predictions, labels)


def _head_state(model: Any) -> dict[str, torch.Tensor]:
    state = model.state_dict()
    return {key: state[key].detach().float().cpu().contiguous() for key in HEAD_KEYS}


def _fit_one(
    config: RoutingConfig,
    train_rows: list[dict[str, Any]],
    validation_rows: list[dict[str, Any]],
    output_dir: Path,
) -> dict[str, Any]:
    from transformers import AutoModel, AutoTokenizer

    settings = config.training
    labels = list(config.routes)
    route_lanes = [f"{label}: {description}" for label, description in config.routes.items()]
    device = torch.device("cuda")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for Router A fine-tuning")
    torch.manual_seed(int(config.seed))
    torch.cuda.manual_seed_all(int(config.seed))
    tokenizer = AutoTokenizer.from_pretrained(
        config.router_a["model_id"],
        revision=config.router_a["revision"],
        trust_remote_code=True,
    )
    model = AutoModel.from_pretrained(
        config.router_a["model_id"],
        revision=config.router_a["revision"],
        trust_remote_code=True,
    ).to(device=device, dtype=torch.bfloat16)
    model.lfm2.requires_grad_(False)
    model.eval()
    trainable = [parameter for parameter in model.parameters() if parameter.requires_grad]
    optimizer = torch.optim.AdamW(
        trainable,
        lr=float(settings["learning_rate"]),
        weight_decay=float(settings["weight_decay"]),
    )
    batch_size = int(settings["batch_size"])
    max_length = int(settings["max_length"])
    best_f1 = -1.0
    best_epoch = 0
    best_state: dict[str, torch.Tensor] | None = None
    history: list[dict[str, Any]] = []
    epochs_without_improvement = 0
    started = time.perf_counter()

    for epoch in range(1, int(settings["epochs"]) + 1):
        order = torch.randperm(
            len(train_rows), generator=torch.Generator().manual_seed(int(config.seed) + epoch)
        ).tolist()
        total_loss = 0.0
        for start in range(0, len(order), batch_size):
            indices = order[start : start + batch_size]
            batch = [train_rows[index] for index in indices]
            encoded, text_pool, category_pool = _encode_batch(
                tokenizer,
                model,
                [row["prompt"] for row in batch],
                route_lanes,
                device,
                max_length,
            )
            targets = torch.tensor(
                [labels.index(row["expected_route"]) for row in batch],
                device=device,
            )
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
                logits = model(**encoded, text_pool=text_pool, category_pool=category_pool)[
                    "logits"
                ]
                loss = F.cross_entropy(logits.float(), targets)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(trainable, 1.0)
            optimizer.step()
            total_loss += float(loss.detach()) * len(batch)

        validation = _evaluate(
            model,
            tokenizer,
            validation_rows,
            labels,
            route_lanes,
            device,
            batch_size,
            max_length,
        )
        row = {
            "epoch": epoch,
            "train_loss": total_loss / len(train_rows),
            "validation_accuracy": validation["accuracy"],
            "validation_macro_f1": validation["macro_f1"],
        }
        history.append(row)
        print(
            f"train={len(train_rows)} epoch={epoch} loss={row['train_loss']:.4f} "
            f"val_f1={row['validation_macro_f1']:.4f}",
            flush=True,
        )
        if validation["macro_f1"] > best_f1:
            best_f1 = float(validation["macro_f1"])
            best_epoch = epoch
            best_state = _head_state(model)
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1
            if epochs_without_improvement >= int(settings["patience"]):
                break

    if best_state is None:
        raise RuntimeError("Training did not produce a checkpoint")
    output_dir.mkdir(parents=True, exist_ok=True)
    save_file(best_state, output_dir / "head.safetensors")
    result = {
        "train_size": len(train_rows),
        "validation_size": len(validation_rows),
        "best_epoch": best_epoch,
        "best_validation_macro_f1": best_f1,
        "history": history,
        "elapsed_seconds": time.perf_counter() - started,
        "peak_cuda_memory_mb": torch.cuda.max_memory_allocated() / 1024**2,
    }
    (output_dir / "training_result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    del model
    torch.cuda.empty_cache()
    return result


def train_router_a(config: RoutingConfig) -> Path:
    data_dir = (config.root / config.synthetic_data["output_dir"]).resolve()
    train_path = data_dir / "train.jsonl"
    validation_path = data_dir / "validation.jsonl"
    train_rows = _read_jsonl(train_path)
    validation_rows = _read_jsonl(validation_path)
    labels = list(config.routes)
    output_dir = (config.root / config.training["output_dir"]).resolve()
    results: list[dict[str, Any]] = []
    for size in config.training["learning_curve_sizes"]:
        subset = _stratified_subset(train_rows, labels, int(size), int(config.seed))
        results.append(_fit_one(config, subset, validation_rows, output_dir / f"curve-{size}"))

    final_size = max(int(size) for size in config.training["learning_curve_sizes"])
    final_head = output_dir / f"curve-{final_size}" / "head.safetensors"
    manifest = {
        "schema_version": "1.0",
        "created_at": datetime.now(UTC).isoformat(),
        "base_model": config.router_a["model_id"],
        "base_revision": config.router_a["revision"],
        "head_path": str(final_head.relative_to(config.root)).replace("\\", "/"),
        "training_mode": "routing-head-only",
        "seed": int(config.seed),
        "dataset": {
            "train_rows": len(train_rows),
            "validation_rows": len(validation_rows),
            "train_sha256": _sha256(train_path),
            "validation_sha256": _sha256(validation_path),
        },
        "training_config": config.training,
        "runtime": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "cuda": torch.version.cuda,
            "gpu": torch.cuda.get_device_name(0),
        },
        "learning_curve": results,
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    figure, axis = plt.subplots(figsize=(9, 5), constrained_layout=True)
    axis.plot(
        [row["train_size"] for row in results],
        [row["best_validation_macro_f1"] for row in results],
        marker="o",
        color="#2563EB",
    )
    axis.set_title("LiquidAI A1 learning curve", loc="left", fontweight="bold")
    axis.set_xlabel("Training examples")
    axis.set_ylabel("Best validation macro-F1")
    axis.set_ylim(0, 1.05)
    axis.grid(alpha=0.2)
    figure.savefig(output_dir / "learning-curve.png", dpi=180, bbox_inches="tight")
    plt.close(figure)
    return manifest_path
