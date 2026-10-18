import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.parametrize("package_import", [False, True])
def test_similarity_entry_point_works_without_extra_pythonpath(package_import: bool) -> None:
    repository = Path(__file__).resolve().parents[2]
    search_path = repository if package_import else repository / "experiments/retrieval_benchmark"
    prefix = "experiments.retrieval_benchmark." if package_import else ""
    script = """
import sys
from importlib import import_module

sys.path.insert(0, sys.argv[1])
benchmark = import_module(sys.argv[2] + "similarity_benchmark")
fixture = import_module(sys.argv[2] + "similarity_demo_fixture")
chunks = benchmark.chunks_from_texts({"document": "요구사항과 견적 근거"})
vectors = benchmark.embed_corpus(chunks, benchmark.HashingEmbedder(dimension=32))
assert vectors.shape == (1, 32)
assert len(fixture.build_demo_cases()) == 72
assert isinstance(fixture.build_demo_cases()[0], benchmark.QueryCase)
"""
    subprocess.run(
        [sys.executable, "-I", "-c", script, str(search_path), prefix],
        check=True,
        capture_output=True,
        text=True,
        timeout=60
    )
