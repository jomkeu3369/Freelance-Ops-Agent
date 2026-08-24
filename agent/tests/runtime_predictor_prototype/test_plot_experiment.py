from __future__ import annotations

from pathlib import Path

from .plot_experiment import build_plot


def test_plot_experiment_writes_png(tmp_path: Path) -> None:
    output = tmp_path / "runtime-prediction.png"

    generated = build_plot(output_path=output, sample_count=400, random_seed=7)

    assert generated == output
    assert output.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
    assert output.stat().st_size > 10_000
