from __future__ import annotations

import numpy as np

from run_qa_reader_benchmark import best_span_margin


def test_best_span_margin_compares_context_span_with_null() -> None:
    start = np.asarray([2.0, 0.0, 4.0, 1.0])
    end = np.asarray([2.0, 0.0, 1.0, 5.0])

    assert best_span_margin(start, end, [2, 3], max_answer_tokens=3) == 5.0


def test_best_span_margin_rejects_reverse_span() -> None:
    start = np.asarray([1.0, 0.0, 2.0, 5.0])
    end = np.asarray([1.0, 0.0, 4.0, 0.0])

    assert best_span_margin(start, end, [2, 3], max_answer_tokens=2) == 4.0
