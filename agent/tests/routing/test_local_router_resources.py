from pathlib import Path

from routing import RouteLabel, load_route_examples

RESOURCE_ROOT = Path(__file__).resolve().parents[2] / "resources" / "routing"


def test_local_router_snapshot_is_self_contained() -> None:
    examples = load_route_examples(RESOURCE_ROOT / "examples.jsonl")

    assert len(examples) == 2500
    assert {example.route for example in examples} == set(RouteLabel)
    assert (RESOURCE_ROOT / "head.safetensors").stat().st_size > 0
