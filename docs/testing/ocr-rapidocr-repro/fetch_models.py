"""Fetch only the official, SHA256-pinned public models; no document upload."""
import hashlib
import json
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parent
models = root / "models"
models.mkdir(exist_ok=True)
for item in json.loads((root / "model-manifest.json").read_text(encoding="utf-8-sig")):
    name = item["name"]
    if Path(name).name != name or item["task"] not in {"det", "cls", "rec"}:
        raise ValueError("Invalid official model name/task")
    expected_url = f"https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/{item['task']}/{name}"
    if item["url"] != expected_url:
        raise ValueError("Unexpected model source")
    path = models / name
    if path.exists():
        if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("Existing model hash mismatch; refuse overwrite")
        continue
    with urllib.request.urlopen(expected_url, timeout=120) as response:
        payload = response.read(25_000_001)
    if not len(payload) == item["bytes"] <= 25_000_000:
        raise ValueError("Unexpected model size")
    if hashlib.sha256(payload).hexdigest() != item["sha256"]:
        raise ValueError("Official model SHA256 mismatch")
    path.write_bytes(payload)
    print(name, len(payload), item["sha256"])
