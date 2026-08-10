from requirement_benchmark.metrics import bootstrap_f1_delta, exact_mcnemar


def test_mcnemar_detects_b_as_better() -> None:
    truth = [0, 0, 1, 1, 0, 1]
    pred_a = [1, 1, 0, 1, 0, 0]
    pred_b = truth
    result = exact_mcnemar(truth, pred_a, pred_b)
    assert result["a_only_correct"] == 0
    assert result["b_only_correct"] == 4
    assert 0 <= result["p_value"] <= 1


def test_bootstrap_delta_direction() -> None:
    truth = [0, 0, 1, 1] * 10
    result = bootstrap_f1_delta(truth, [0] * 40, truth, iterations=100, seed=7)
    assert result["median_delta"] > 0

