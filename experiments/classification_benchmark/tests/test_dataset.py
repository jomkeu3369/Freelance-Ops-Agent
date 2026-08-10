from requirement_benchmark.dataset import RequirementExample, stratified_limit
from requirement_benchmark.pipeline import select_paired_prediction_ids


def test_stratified_limit_is_balanced_and_deterministic() -> None:
    rows = [RequirementExample(str(index), str(index), index % 2) for index in range(20)]
    first = stratified_limit(rows, 8, seed=42)
    second = stratified_limit(rows, 8, seed=42)
    assert first == second
    assert len(first) == 8
    assert sum(row.label == 0 for row in first) == 4
    assert sum(row.label == 1 for row in first) == 4


def test_judge_sample_ids_are_paired() -> None:
    classifiers = [
        {"predictions": [{"id": f"test-{index}"} for index in range(10)]},
        {"predictions": [{"id": f"test-{index}"} for index in range(5, 15)]},
    ]
    selected = select_paired_prediction_ids(classifiers, 4, seed=42)
    assert len(selected) == 4
    assert set(selected).issubset({f"test-{index}" for index in range(5, 10)})
